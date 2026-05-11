import { type PoolClient } from "pg";
import {
  type TableDiff,
  type UpdateRecord,
  type InsertRecord,
  type DeleteRecord,
} from "../diff/diff-schema";
import { deserializeValue } from "../diff/serialize-value";
import { insertRow, upsertRow, updateRow, deleteRow } from "../db/sql";
import { fetchColumnTypeMap } from "../db/metadata";
import {
  type ApplySummary,
  type SkippedRow,
  type ConflictRow,
} from "../shared/summary";

export interface ApplyTableOptions {
  dryRun: boolean;
  applyInserts: boolean;
  applyUpdates: boolean;
  applyDeletes: boolean;
  conflictMode: "abort" | "skip" | "overwrite";
  insertMode: "strict" | "upsert";
  verbose: boolean;
}

/**
 * Applies a single table diff to the destination database.
 * Modifies summary in-place.
 */
export async function applyTableDiff(
  client: PoolClient,
  tableDiff: TableDiff,
  options: ApplyTableOptions,
  summary: ApplySummary,
): Promise<void> {
  const { schema, table, primaryKey, inserts, updates, deletes } = tableDiff;

  // Fetch column type metadata for type-correct guard WHERE clauses.
  // Skip if dry-run and there's nothing to process.
  let columnTypes: Record<string, string> = {};
  const needsTypes =
    !options.dryRun &&
    ((options.applyUpdates && updates.length > 0) ||
      (options.applyDeletes && deletes.length > 0));
  if (needsTypes) {
    columnTypes = await fetchColumnTypeMap(client, schema, table);
  }

  // 1. Inserts
  if (options.applyInserts && inserts.length > 0) {
    for (const record of inserts) {
      await applyInsert(
        client,
        schema,
        table,
        primaryKey,
        record,
        options,
        summary,
      );
    }
  }

  // 2. Updates
  if (options.applyUpdates && updates.length > 0) {
    for (const record of updates) {
      await applyUpdate(
        client,
        schema,
        table,
        primaryKey,
        record,
        options,
        summary,
        columnTypes,
      );
    }
  }

  // 3. Deletes (only if explicitly enabled)
  if (options.applyDeletes && deletes.length > 0) {
    for (const record of deletes) {
      await applyDelete(
        client,
        schema,
        table,
        primaryKey,
        record,
        options,
        summary,
        columnTypes,
      );
    }
  }
}

async function applyInsert(
  client: PoolClient,
  schema: string,
  table: string,
  pkColumns: string[],
  record: InsertRecord,
  options: ApplyTableOptions,
  summary: ApplySummary,
): Promise<void> {
  const columns = Object.keys(record.row);
  const deserializedRow: Record<string, unknown> = {};
  for (const col of columns) {
    deserializedRow[col] = deserializeValue(record.row[col]);
  }

  const pkValues: Record<string, unknown> = {};
  for (const col of pkColumns) {
    pkValues[col] = deserializedRow[col];
  }

  if (options.verbose) {
    console.log(
      `  INSERT into ${schema}.${table} pk=${JSON.stringify(pkValues)}`,
    );
  }

  if (options.dryRun) {
    summary.applied.inserts++;
    return;
  }

  if (options.conflictMode === "skip" || options.conflictMode === "overwrite") {
    // Use a savepoint so a failure doesn't abort the entire transaction
    const sp = `sp_insert_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      if (options.insertMode === "upsert") {
        await upsertRow(
          client,
          schema,
          table,
          deserializedRow,
          columns,
          pkColumns,
        );
      } else {
        await insertRow(client, schema, table, deserializedRow, columns);
      }
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      summary.applied.inserts++;
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
      if (options.conflictMode === "skip") {
        const reason = err instanceof Error ? err.message : String(err);
        summary.skipped.push({
          table: `${schema}.${table}`,
          operation: "insert",
          pk: pkValues,
          reason,
        });
      } else {
        // overwrite: try upsert as fallback
        await upsertRow(
          client,
          schema,
          table,
          deserializedRow,
          columns,
          pkColumns,
        );
        summary.applied.inserts++;
      }
    }
  } else {
    // abort mode: let errors propagate directly
    try {
      if (options.insertMode === "upsert") {
        await upsertRow(
          client,
          schema,
          table,
          deserializedRow,
          columns,
          pkColumns,
        );
      } else {
        // strict: will throw if PK already exists
        await insertRow(client, schema, table, deserializedRow, columns);
      }
      summary.applied.inserts++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ConflictError(
        `Insert conflict in ${schema}.${table} pk=${JSON.stringify(pkValues)}: ${reason}`,
      );
    }
  }
}

async function applyUpdate(
  client: PoolClient,
  schema: string,
  table: string,
  pkColumns: string[],
  record: UpdateRecord,
  options: ApplyTableOptions,
  summary: ApplySummary,
  columnTypes: Record<string, string> = {},
): Promise<void> {
  const pkValues: Record<string, unknown> = {};
  for (const col of pkColumns) {
    pkValues[col] = deserializeValue(record.pk[col]);
  }

  const setColumns = Object.keys(record.changes);
  const setValues: Record<string, unknown> = {};

  for (const col of setColumns) {
    setValues[col] = deserializeValue(record.changes[col].to);
  }

  if (options.verbose) {
    console.log(
      `  UPDATE ${schema}.${table} pk=${JSON.stringify(pkValues)} columns=[${setColumns.join(", ")}]`,
    );
  }

  if (options.dryRun) {
    summary.applied.updates++;
    return;
  }

  const guardCols: string[] = [];
  const guardVals: Record<string, unknown> = {};
  if (options.conflictMode !== "overwrite") {
    for (const [col, value] of Object.entries(record.guard)) {
      if (!pkColumns.includes(col)) {
        guardCols.push(col);
        guardVals[col] = deserializeValue(value);
      }
    }
  }

  const rowsUpdated = await updateRow(
    client,
    schema,
    table,
    pkColumns,
    pkValues,
    setColumns,
    setValues,
    guardCols,
    guardVals,
    columnTypes,
  );

  if (rowsUpdated === 0) {
    // Either PK not found, or guard failed
    const reason =
      "Row not found or guard check failed (destination row may have changed)";
    if (options.conflictMode === "abort") {
      throw new ConflictError(
        `Update conflict in ${schema}.${table} pk=${JSON.stringify(pkValues)}: ${reason}`,
      );
    } else if (options.conflictMode === "skip") {
      summary.skipped.push({
        table: `${schema}.${table}`,
        operation: "update",
        pk: pkValues,
        reason,
      });
    }
  } else {
    summary.applied.updates++;
  }
}

async function applyDelete(
  client: PoolClient,
  schema: string,
  table: string,
  pkColumns: string[],
  record: DeleteRecord,
  options: ApplyTableOptions,
  summary: ApplySummary,
  columnTypes: Record<string, string> = {},
): Promise<void> {
  const pkValues: Record<string, unknown> = {};
  for (const col of pkColumns) {
    pkValues[col] = deserializeValue(record.pk[col]);
  }

  // Build guard from all guard columns (not just pk)
  const guardColumns = Object.keys(record.guard).filter(
    (c) => !pkColumns.includes(c),
  );
  const guardVals: Record<string, unknown> = {};
  for (const col of guardColumns) {
    guardVals[col] = deserializeValue(record.guard[col]);
  }

  if (options.verbose) {
    console.log(
      `  DELETE from ${schema}.${table} pk=${JSON.stringify(pkValues)}`,
    );
  }

  if (options.dryRun) {
    summary.applied.deletes++;
    return;
  }

  // Always use guarded delete (abort/skip modes check guards)
  const rowsDeleted = await deleteRow(
    client,
    schema,
    table,
    pkColumns,
    pkValues,
    guardColumns,
    guardVals,
    columnTypes,
  );

  if (rowsDeleted === 0) {
    const reason =
      "Row not found or guard check failed (destination row may have changed)";
    if (options.conflictMode === "abort") {
      throw new ConflictError(
        `Delete conflict in ${schema}.${table} pk=${JSON.stringify(pkValues)}: ${reason}`,
      );
    } else if (options.conflictMode === "skip") {
      summary.skipped.push({
        table: `${schema}.${table}`,
        operation: "delete",
        pk: pkValues,
        reason,
      });
    }
  } else {
    summary.applied.deletes++;
  }
}

/**
 * Thrown when a conflict is detected in abort mode.
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
