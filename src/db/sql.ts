import { type PoolClient } from "pg";
import { quoteIdentifier, quoteQualifiedTable } from "../shared/identifiers";

/**
 * Builds a parameterized WHERE clause for primary key equality.
 * Returns the clause and the parameter values.
 *
 * Example: pk = ['id', 'tenant_id'], pkValues = {id: 1, tenant_id: 2}
 * Result: `"id" = $1 AND "tenant_id" = $2`, [1, 2]
 */
export function buildPkWhereClause(
  pkColumns: string[],
  pkValues: Record<string, unknown>,
  startIndex: number = 1,
): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < pkColumns.length; i++) {
    const col = pkColumns[i];
    parts.push(`${quoteIdentifier(col)} = $${startIndex + i}`);
    params.push(pkValues[col]);
  }
  return { clause: parts.join(" AND "), params };
}

/**
 * PostgreSQL types that have no equality operator and cannot be used in IS NOT DISTINCT FROM.
 * These columns are skipped from guard WHERE clauses.
 * The primary key check is still present to ensure the correct row is targeted.
 */
const UNGUARDABLE_TYPES = new Set([
  "point",
  "line",
  "lseg",
  "box",
  "path",
  "polygon",
  "circle",
]);

/**
 * Geometric and special PostgreSQL data types that need an explicit cast in parameterized queries
 * when the value is passed as a string.
 */
const TYPES_NEEDING_CAST: Record<string, string> = {
  // Range types (pg returns as strings, need explicit cast for unambiguous type resolution)
  int4range: "int4range",
  int8range: "int8range",
  numrange: "numrange",
  tsrange: "tsrange",
  tstzrange: "tstzrange",
  daterange: "daterange",
  // Interval type
  interval: "interval",
};

/**
 * Builds a parameterized WHERE clause using IS NOT DISTINCT FROM semantics
 * for NULL-safe comparison.
 *
 * When a column type map is provided:
 * - geometric types (point, circle, etc.): skipped — PostgreSQL has no equality operator for them.
 *   The PK check still ensures the correct row is targeted.
 * - json/jsonb columns: both sides are cast to jsonb for structural comparison
 * - interval and range types: parameter gets an explicit type cast
 *
 * @param columns - Column names to include in the WHERE clause
 * @param values  - Deserialized values for each column
 * @param startIndex - Paramter index offset (default 1)
 * @param columnTypes - Optional map of column name -> PostgreSQL data_type
 */
export function buildNullSafeWhereClause(
  columns: string[],
  values: Record<string, unknown>,
  startIndex: number = 1,
  columnTypes?: Record<string, string>,
): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let paramIndex = startIndex;

  for (const col of columns) {
    const val = values[col];
    const dataType = columnTypes?.[col];

    // Skip columns whose types don't support equality (e.g., geometric types)
    if (dataType && UNGUARDABLE_TYPES.has(dataType)) {
      continue;
    }

    if (dataType === "json" || dataType === "jsonb") {
      if (val === null || val === undefined) {
        parts.push(
          `${quoteIdentifier(col)} IS NOT DISTINCT FROM $${paramIndex}`,
        );
        params.push(null);
      } else {
        // Cast both sides to jsonb for structural comparison (handles key ordering)
        // and avoids "operator does not exist: json = unknown"
        parts.push(
          `${quoteIdentifier(col)}::jsonb IS NOT DISTINCT FROM $${paramIndex}::jsonb`,
        );
        params.push(
          typeof val === "object" ? JSON.stringify(val) : String(val),
        );
      }
    } else if (dataType && TYPES_NEEDING_CAST[dataType] !== undefined) {
      // Interval and range types: add explicit cast for unambiguous type resolution
      const castType = TYPES_NEEDING_CAST[dataType];
      if (val === null || val === undefined) {
        parts.push(
          `${quoteIdentifier(col)} IS NOT DISTINCT FROM $${paramIndex}`,
        );
        params.push(null);
      } else {
        parts.push(
          `${quoteIdentifier(col)} IS NOT DISTINCT FROM $${paramIndex}::${castType}`,
        );
        params.push(val);
      }
    } else if (
      val !== null &&
      val !== undefined &&
      typeof val === "object" &&
      !Buffer.isBuffer(val) &&
      !Array.isArray(val)
    ) {
      // Fallback for unknown object types without type map: use jsonb cast
      parts.push(
        `${quoteIdentifier(col)}::jsonb IS NOT DISTINCT FROM $${paramIndex}::jsonb`,
      );
      params.push(JSON.stringify(val));
    } else {
      parts.push(`${quoteIdentifier(col)} IS NOT DISTINCT FROM $${paramIndex}`);
      params.push(val);
    }
    paramIndex++;
  }
  return { clause: parts.join(" AND "), params };
}

/**
 * Fetches all rows from a table ordered by primary key, in batches.
 * Returns rows as an array of plain objects.
 */
export async function fetchRowsBatched(
  client: PoolClient,
  schema: string,
  table: string,
  columns: string[],
  pkColumns: string[],
  batchSize: number = 1000,
  whereDataFilter?: string,
  onBatchProgress?: (progress: FetchRowsBatchProgress) => void,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  let batchNumber = 0;

  while (true) {
    batchNumber++;

    const query = buildSelectRowsQuery({
      schema,
      table,
      columns,
      pkColumns,
      limitParam: 1,
      offsetParam: 2,
      whereDataFilter,
    });
    const result = await client.query<Record<string, unknown>>(query, [
      batchSize,
      offset,
    ]);
    rows.push(...result.rows);

    if (onBatchProgress) {
      onBatchProgress({
        batchNumber,
        batchRows: result.rows.length,
        fetchedRows: rows.length,
      });
    }

    if (result.rows.length < batchSize) {
      break;
    }

    offset += batchSize;
  }

  return rows;
}

export interface FetchRowsBatchProgress {
  batchNumber: number;
  batchRows: number;
  fetchedRows: number;
}

export function buildSelectRowsQuery(options: {
  schema: string;
  table: string;
  columns: string[];
  pkColumns: string[];
  limitParam: number;
  offsetParam: number;
  whereDataFilter?: string;
}): string {
  const qualifiedTable = quoteQualifiedTable(options.schema, options.table);
  const quotedColumns = options.columns.map(quoteIdentifier).join(", ");
  const orderBy = options.pkColumns.map(quoteIdentifier).join(", ");
  const whereClause =
    options.whereDataFilter !== undefined
      ? ` WHERE (${options.whereDataFilter})`
      : "";

  return `SELECT ${quotedColumns} FROM ${qualifiedTable}${whereClause} ORDER BY ${orderBy} LIMIT $${options.limitParam} OFFSET $${options.offsetParam}`;
}

/**
 * Executes an INSERT statement for a single row.
 * Uses parameterized queries — never string-concatenates values.
 */
export async function insertRow(
  client: PoolClient,
  schema: string,
  table: string,
  row: Record<string, unknown>,
  columns: string[],
): Promise<void> {
  const qualifiedTable = quoteQualifiedTable(schema, table);
  const quotedCols = columns.map(quoteIdentifier).join(", ");
  const params = columns.map((c) => row[c]);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  await client.query(
    `INSERT INTO ${qualifiedTable} (${quotedCols}) VALUES (${placeholders})`,
    params,
  );
}

/**
 * Executes an UPSERT (INSERT ... ON CONFLICT DO UPDATE) for a single row.
 */
export async function upsertRow(
  client: PoolClient,
  schema: string,
  table: string,
  row: Record<string, unknown>,
  columns: string[],
  pkColumns: string[],
): Promise<void> {
  const qualifiedTable = quoteQualifiedTable(schema, table);
  const quotedCols = columns.map(quoteIdentifier).join(", ");
  const params = columns.map((c) => row[c]);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const conflictCols = pkColumns.map(quoteIdentifier).join(", ");

  const updateCols = columns
    .filter((c) => !pkColumns.includes(c))
    .map((c, i) => {
      const paramIndex = columns.indexOf(c) + 1;
      return `${quoteIdentifier(c)} = $${paramIndex}`;
    })
    .join(", ");

  if (updateCols === "") {
    // Only PK columns — just do a plain insert that ignores conflicts
    await client.query(
      `INSERT INTO ${qualifiedTable} (${quotedCols}) VALUES (${placeholders}) ON CONFLICT (${conflictCols}) DO NOTHING`,
      params,
    );
  } else {
    await client.query(
      `INSERT INTO ${qualifiedTable} (${quotedCols}) VALUES (${placeholders}) ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateCols}`,
      params,
    );
  }
}

/**
 * Executes an UPDATE statement for a single row with guarded column checks.
 * Uses IS NOT DISTINCT FROM for NULL-safe comparisons.
 *
 * Returns the number of rows actually updated (0 or 1).
 */
export async function updateRow(
  client: PoolClient,
  schema: string,
  table: string,
  pkColumns: string[],
  pkValues: Record<string, unknown>,
  setColumns: string[],
  setValues: Record<string, unknown>,
  guardColumns: string[],
  guardValues: Record<string, unknown>,
  columnTypes?: Record<string, string>,
): Promise<number> {
  const qualifiedTable = quoteQualifiedTable(schema, table);

  const setParams: unknown[] = [];
  const setClauses = setColumns.map((col, i) => {
    setParams.push(setValues[col]);
    return `${quoteIdentifier(col)} = $${i + 1}`;
  });

  const guardStartIndex = setParams.length + 1;
  const pkWhere = buildPkWhereClause(pkColumns, pkValues, guardStartIndex);
  const allParams = [...setParams, ...pkWhere.params];

  let whereClause = pkWhere.clause;
  const guardStartIndex2 = allParams.length + 1;

  if (guardColumns.length > 0) {
    const guardWhere = buildNullSafeWhereClause(
      guardColumns,
      guardValues,
      guardStartIndex2,
      columnTypes,
    );
    allParams.push(...guardWhere.params);
    whereClause += " AND " + guardWhere.clause;
  }

  const result = await client.query(
    `UPDATE ${qualifiedTable} SET ${setClauses.join(", ")} WHERE ${whereClause}`,
    allParams,
  );
  return result.rowCount ?? 0;
}

/**
 * Executes a DELETE statement for a single row with guard checks.
 * Returns the number of rows deleted (0 or 1).
 */
export async function deleteRow(
  client: PoolClient,
  schema: string,
  table: string,
  pkColumns: string[],
  pkValues: Record<string, unknown>,
  guardColumns: string[],
  guardValues: Record<string, unknown>,
  columnTypes?: Record<string, string>,
): Promise<number> {
  const qualifiedTable = quoteQualifiedTable(schema, table);

  const pkWhere = buildPkWhereClause(pkColumns, pkValues, 1);
  let allParams: unknown[] = [...pkWhere.params];
  let whereClause = pkWhere.clause;

  if (guardColumns.length > 0) {
    const guardWhere = buildNullSafeWhereClause(
      guardColumns,
      guardValues,
      allParams.length + 1,
      columnTypes,
    );
    allParams = [...allParams, ...guardWhere.params];
    whereClause += " AND " + guardWhere.clause;
  }

  const result = await client.query(
    `DELETE FROM ${qualifiedTable} WHERE ${whereClause}`,
    allParams,
  );
  return result.rowCount ?? 0;
}
