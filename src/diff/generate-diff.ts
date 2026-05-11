import { Pool } from "pg";
import { fetchTableMetadata, type ColumnInfo } from "../db/metadata";
import { fetchRowsBatched } from "../db/sql";
import { serializeValue, valuesAreEqual } from "./serialize-value";
import {
  type DiffJson,
  type TableDiff,
  type UpdateRecord,
  type InsertRecord,
  type DeleteRecord,
} from "./diff-schema";
import { validateIdentifier } from "../shared/identifiers";

export interface GenerateDiffOptions {
  schema: string;
  tables: string[];
  excludeTables: string[];
  ignoreColumns: string[];
  tablesWhereDataFilters?: Record<string, string>;
  includeDeletes: boolean;
  skipMissingPk: boolean;
  verbose: boolean;
  onProgress?: (message: string) => void;
  onVerboseProgress?: (message: string) => void;
}

/**
 * Generates a full diff between source and dest databases.
 * Compares tables row by row using primary key matching.
 */
export async function generateDiff(
  sourcePool: Pool,
  destPool: Pool,
  options: GenerateDiffOptions,
): Promise<DiffJson> {
  const sourceClient = await sourcePool.connect();
  const destClient = await destPool.connect();

  const tableDiffs: TableDiff[] = [];
  const skippedTables: string[] = [];
  let totalUpdates = 0;
  let totalInserts = 0;
  let totalDeletes = 0;

  try {
    for (const [tableIndex, table] of options.tables.entries()) {
      const progressLabel = formatTableProgressLabel(
        tableIndex + 1,
        options.tables.length,
        options.schema,
        table,
      );

      if (options.excludeTables.includes(table)) {
        reportVerboseProgress(
          options,
          `${progressLabel}: skipping excluded table`,
        );
        continue;
      }

      validateIdentifier(table, "table name");

      reportProgress(
        options.onProgress,
        `${progressLabel}: loading table metadata`,
      );

      // Fetch metadata from both source and dest
      const [sourceMeta, destMeta] = await Promise.all([
        fetchTableMetadata(sourceClient, options.schema, table),
        fetchTableMetadata(destClient, options.schema, table),
      ]);

      // Primary key check
      if (!sourceMeta.hasPrimaryKey) {
        if (options.skipMissingPk) {
          console.warn(
            `Skipping table without primary key: ${options.schema}.${table}`,
          );
          skippedTables.push(table);
          continue;
        } else {
          throw new Error(
            `Table ${options.schema}.${table} has no primary key. ` +
              `Use --skip-missing-pk to skip tables without primary keys.`,
          );
        }
      }

      // Find common columns (present in both source and dest, not generated, not ignored)
      const sourceColSet = new Set(sourceMeta.normalColumns);
      const destColSet = new Set(destMeta.normalColumns);
      const commonColumns = sourceMeta.normalColumns.filter(
        (c) => destColSet.has(c) && !options.ignoreColumns.includes(c),
      );

      const pkColumns = sourceMeta.primaryKey;

      // Build a map of column name -> data type for type-aware serialization
      const colTypeMap = buildColTypeMap(sourceMeta.columns);

      // Ensure pk columns are always fetched even if ignored
      const fetchColumns = [...new Set([...pkColumns, ...commonColumns])];

      reportVerboseProgress(
        options,
        `${progressLabel}: using primary key ${pkColumns.join(", ")} and ${commonColumns.length} comparable column(s)`,
      );

      // Fetch all rows from source and dest
      const whereDataFilter = options.tablesWhereDataFilters?.[table];
      reportProgress(
        options.onProgress,
        `${progressLabel}: fetching source and destination rows`,
      );

      const sourceRowsPromise = fetchRowsBatched(
        sourceClient,
        options.schema,
        table,
        fetchColumns,
        pkColumns,
        undefined,
        whereDataFilter,
        (progress) => {
          reportVerboseProgress(
            options,
            `${progressLabel}: source batch ${progress.batchNumber} fetched ${progress.batchRows} row(s), ${progress.fetchedRows} total`,
          );
        },
      );
      const destRowsPromise = fetchRowsBatched(
        destClient,
        options.schema,
        table,
        fetchColumns,
        pkColumns,
        undefined,
        whereDataFilter,
        (progress) => {
          reportVerboseProgress(
            options,
            `${progressLabel}: destination batch ${progress.batchNumber} fetched ${progress.batchRows} row(s), ${progress.fetchedRows} total`,
          );
        },
      );
      const [sourceRows, destRows] = await Promise.all([
        sourceRowsPromise,
        destRowsPromise,
      ]);

      reportProgress(
        options.onProgress,
        `${progressLabel}: fetched ${sourceRows.length} source row(s) and ${destRows.length} destination row(s)`,
      );
      reportProgress(
        options.onProgress,
        `${progressLabel}: comparing row sets`,
      );

      // Index dest rows by PK
      const destByPk = new Map<string, Record<string, unknown>>();
      for (const row of destRows) {
        const pk = buildPkKey(pkColumns, row, colTypeMap);
        destByPk.set(pk, row);
      }

      const updates: UpdateRecord[] = [];
      const inserts: InsertRecord[] = [];
      const deletes: DeleteRecord[] = [];

      // Compare source rows against dest
      const seenPkKeys = new Set<string>();

      for (const sourceRow of sourceRows) {
        const pkKey = buildPkKey(pkColumns, sourceRow, colTypeMap);
        seenPkKeys.add(pkKey);
        const pkValues = extractPkValues(pkColumns, sourceRow);
        const destRow = destByPk.get(pkKey);

        if (!destRow) {
          // Row exists in source but not in dest -> INSERT
          const serializedRow: Record<string, unknown> = {};
          for (const col of fetchColumns) {
            serializedRow[col] = serializeValue(
              sourceRow[col],
              colTypeMap[col],
            );
          }
          inserts.push({ row: serializedRow });
        } else {
          // Row exists in both -> check for changes
          const changes: Record<string, { from: unknown; to: unknown }> = {};
          const compareColumns = commonColumns.filter(
            (c) => !pkColumns.includes(c),
          );

          for (const col of compareColumns) {
            const srcVal = serializeValue(sourceRow[col], colTypeMap[col]);
            const dstVal = serializeValue(destRow[col], colTypeMap[col]);
            if (!valuesAreEqual(srcVal, dstVal)) {
              changes[col] = { from: dstVal, to: srcVal };
            }
          }

          if (Object.keys(changes).length > 0) {
            const serializedPk: Record<string, unknown> = {};
            for (const col of pkColumns) {
              serializedPk[col] = serializeValue(
                pkValues[col],
                colTypeMap[col],
              );
            }
            const guard: Record<string, unknown> = {};
            for (const col of fetchColumns) {
              guard[col] = serializeValue(destRow[col], colTypeMap[col]);
            }
            updates.push({ pk: serializedPk, changes, guard });
          }
        }
      }

      // Find deletes: rows in dest that are not in source
      if (options.includeDeletes) {
        for (const destRow of destRows) {
          const pkKey = buildPkKey(pkColumns, destRow, colTypeMap);
          if (!seenPkKeys.has(pkKey)) {
            const pkValues = extractPkValues(pkColumns, destRow);
            const serializedPk: Record<string, unknown> = {};
            for (const col of pkColumns) {
              serializedPk[col] = serializeValue(
                pkValues[col],
                colTypeMap[col],
              );
            }

            // Build guard from all non-ignored, non-generated columns
            const guard: Record<string, unknown> = {};
            for (const col of fetchColumns) {
              guard[col] = serializeValue(destRow[col], colTypeMap[col]);
            }

            deletes.push({ pk: serializedPk, guard });
          }
        }
      }

      if (updates.length > 0 || inserts.length > 0 || deletes.length > 0) {
        tableDiffs.push({
          table,
          schema: options.schema,
          primaryKey: pkColumns,
          columnTypes: colTypeMap,
          updates,
          inserts,
          deletes,
        });
      }

      totalUpdates += updates.length;
      totalInserts += inserts.length;
      totalDeletes += deletes.length;

      reportProgress(
        options.onProgress,
        `${progressLabel}: completed with ${inserts.length} insert(s), ${updates.length} update(s), ${deletes.length} delete(s)`,
      );
    }
  } finally {
    sourceClient.release();
    destClient.release();
  }

  return {
    format: "postgres-data-diff-json/v1",
    generatedAt: new Date().toISOString(),
    source: { schema: options.schema },
    dest: { schema: options.schema },
    options: {
      includeDeletes: options.includeDeletes,
      ignoredColumns: options.ignoreColumns,
    },
    tables: tableDiffs,
    summary: {
      tablesCompared: options.tables.length - skippedTables.length,
      updates: totalUpdates,
      inserts: totalInserts,
      deletes: totalDeletes,
      skippedTables,
    },
  };
}

/**
 * Builds a string key from primary key column values.
 */
function buildPkKey(
  pkColumns: string[],
  row: Record<string, unknown>,
  colTypeMap: Record<string, string>,
): string {
  return pkColumns
    .map((col) => JSON.stringify(serializeValue(row[col], colTypeMap[col])))
    .join("|||");
}

/**
 * Builds a map from column name to data type for type-aware serialization.
 */
function buildColTypeMap(columns: ColumnInfo[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const col of columns) {
    map[col.columnName] = col.dataType;
  }
  return map;
}

/**
 * Extracts primary key values from a row.
 */
function extractPkValues(
  pkColumns: string[],
  row: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const col of pkColumns) {
    result[col] = row[col];
  }
  return result;
}

function formatTableProgressLabel(
  tablePosition: number,
  totalTables: number,
  schema: string,
  table: string,
): string {
  return `[data ${tablePosition}/${totalTables}] ${schema}.${table}`;
}

function reportProgress(
  callback: ((message: string) => void) | undefined,
  message: string,
): void {
  if (callback) {
    callback(message);
  }
}

function reportVerboseProgress(
  options: Pick<GenerateDiffOptions, "verbose" | "onVerboseProgress">,
  message: string,
): void {
  if (!options.verbose) {
    return;
  }

  if (options.onVerboseProgress) {
    options.onVerboseProgress(message);
    return;
  }

  console.log(message);
}
