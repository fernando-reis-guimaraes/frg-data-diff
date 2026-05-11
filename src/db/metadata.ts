import { type Pool, type PoolClient } from "pg";

export interface ColumnInfo {
  columnName: string;
  dataType: string;
  udtSchema: string;
  udtName: string;
  isNullable: boolean;
  isGenerated: boolean;
  generationExpression: string | null;
  columnDefault: string | null;
  characterMaximumLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  datetimePrecision: number | null;
  intervalType: string | null;
  intervalPrecision: number | null;
  domainSchema: string | null;
  domainName: string | null;
  ordinalPosition: number;
}

export interface TableMetadata {
  schema: string;
  table: string;
  primaryKey: string[];
  primaryKeyConstraintName: string | null;
  columns: ColumnInfo[];
  /** Column names that are not generated (safe to read/write) */
  normalColumns: string[];
  hasPrimaryKey: boolean;
}

/**
 * Fetches primary key column names for the given table.
 */
async function fetchPrimaryKey(
  client: PoolClient,
  schema: string,
  table: string,
): Promise<{ columns: string[]; constraintName: string | null }> {
  const result = await client.query<{
    column_name: string;
    key_seq: number;
    constraint_name: string;
  }>(
    `
    SELECT tc.constraint_name, kcu.column_name, kcu.ordinal_position AS key_seq
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
      AND tc.table_name = kcu.table_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = $1
      AND tc.table_name = $2
    ORDER BY kcu.ordinal_position
    `,
    [schema, table],
  );
  return {
    columns: result.rows.map((r) => r.column_name),
    constraintName: result.rows[0]?.constraint_name ?? null,
  };
}

/**
 * Fetches column information for the given table.
 * Includes generated columns so they can be excluded from comparisons.
 */
async function fetchColumns(
  client: PoolClient,
  schema: string,
  table: string,
): Promise<ColumnInfo[]> {
  const result = await client.query<{
    column_name: string;
    data_type: string;
    udt_schema: string;
    udt_name: string;
    is_nullable: string;
    is_generated: string;
    generation_expression: string | null;
    column_default: string | null;
    character_maximum_length: number | null;
    numeric_precision: number | null;
    numeric_scale: number | null;
    datetime_precision: number | null;
    interval_type: string | null;
    interval_precision: number | null;
    domain_schema: string | null;
    domain_name: string | null;
    ordinal_position: number;
  }>(
    `
    SELECT
      column_name,
      data_type,
      udt_schema,
      udt_name,
      is_nullable,
      is_generated,
      generation_expression,
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      datetime_precision,
      interval_type,
      interval_precision,
      domain_schema,
      domain_name,
      ordinal_position
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
    ORDER BY ordinal_position
    `,
    [schema, table],
  );
  return result.rows.map((r) => ({
    columnName: r.column_name,
    dataType: r.data_type,
    udtSchema: r.udt_schema,
    udtName: r.udt_name,
    isNullable: r.is_nullable === "YES",
    isGenerated: r.is_generated === "ALWAYS",
    generationExpression: r.generation_expression,
    columnDefault: r.column_default,
    characterMaximumLength: r.character_maximum_length,
    numericPrecision: r.numeric_precision,
    numericScale: r.numeric_scale,
    datetimePrecision: r.datetime_precision,
    intervalType: r.interval_type,
    intervalPrecision: r.interval_precision,
    domainSchema: r.domain_schema,
    domainName: r.domain_name,
    ordinalPosition: r.ordinal_position,
  }));
}

/**
 * Fetches full metadata for a table: columns, primary key, generated columns.
 */
export async function fetchTableMetadata(
  client: PoolClient,
  schema: string,
  table: string,
): Promise<TableMetadata> {
  const [primaryKey, columns] = await Promise.all([
    fetchPrimaryKey(client, schema, table),
    fetchColumns(client, schema, table),
  ]);

  const normalColumns = columns
    .filter((c) => !c.isGenerated)
    .map((c) => c.columnName);

  return {
    schema,
    table,
    primaryKey: primaryKey.columns,
    primaryKeyConstraintName: primaryKey.constraintName,
    columns,
    normalColumns,
    hasPrimaryKey: primaryKey.columns.length > 0,
  };
}

/**
 * Lists all base tables in the given schema.
 */
export async function listTables(
  client: PoolClient,
  schema: string,
): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
    `,
    [schema],
  );
  return result.rows.map((r) => r.table_name);
}

/**
 * Verifies that all requested tables exist in the database.
 * Returns the list of tables that were found.
 */
export async function verifyTablesExist(
  pool: Pool,
  schema: string,
  tables: string[],
): Promise<{ found: string[]; missing: string[] }> {
  const client = await pool.connect();
  try {
    const existing = await listTables(client, schema);
    const existingSet = new Set(existing);
    const found = tables.filter((t) => existingSet.has(t));
    const missing = tables.filter((t) => !existingSet.has(t));
    return { found, missing };
  } finally {
    client.release();
  }
}

export interface ResolvedTablePatterns {
  tables: string[];
  excludedTables: string[];
}

interface ResolveTablePatternOptions {
  availability?: "common" | "either";
}

/**
 * Resolves include/exclude table patterns against tables that exist in both databases.
 * Supports "*" as a wildcard within a table name pattern.
 */
export function resolveTablePatternsFromTableLists(
  sourceTables: string[],
  destTables: string[],
  includePatterns: string[],
  excludePatterns: string[],
  options: ResolveTablePatternOptions = {},
): ResolvedTablePatterns {
  const availability = options.availability ?? "common";
  const sourceSet = new Set(sourceTables);
  const destSet = new Set(destTables);
  const availableTables =
    availability === "either"
      ? Array.from(new Set([...sourceTables, ...destTables])).sort()
      : sourceTables.filter((table) => destSet.has(table));
  const resolvedTables: string[] = [];

  for (const pattern of includePatterns) {
    const matches = resolvePattern(pattern, availableTables);
    if (matches.length > 0) {
      for (const match of matches) {
        if (!resolvedTables.includes(match)) {
          resolvedTables.push(match);
        }
      }
      continue;
    }

    if (!hasWildcard(pattern)) {
      const missingFrom: string[] = [];
      if (!sourceSet.has(pattern)) missingFrom.push("source");
      if (!destSet.has(pattern)) missingFrom.push("destination");
      throw new Error(
        `Table "${pattern}" was not found in the ${missingFrom.join(" and ")} database.`,
      );
    }

    if (availability === "either") {
      throw new Error(
        `Table pattern "${pattern}" matched no tables present in either database.`,
      );
    }
    throw new Error(
      `Table pattern "${pattern}" matched no tables present in both databases.`,
    );
  }

  const excludedTables = Array.from(
    new Set(
      excludePatterns.flatMap((pattern) =>
        resolvePattern(pattern, resolvedTables),
      ),
    ),
  );

  const tables = resolvedTables.filter(
    (table) => !excludedTables.includes(table),
  );
  if (tables.length === 0) {
    throw new Error(
      "No tables remain after applying include and exclude table patterns.",
    );
  }

  return { tables, excludedTables };
}

/**
 * Lists tables in both databases and resolves include/exclude patterns.
 */
export async function resolveTablePatterns(
  sourcePool: Pool,
  destPool: Pool,
  schema: string,
  includePatterns: string[],
  excludePatterns: string[],
): Promise<ResolvedTablePatterns> {
  const [sourceClient, destClient] = await Promise.all([
    sourcePool.connect(),
    destPool.connect(),
  ]);
  try {
    const [sourceTables, destTables] = await Promise.all([
      listTables(sourceClient, schema),
      listTables(destClient, schema),
    ]);
    return resolveTablePatternsFromTableLists(
      sourceTables,
      destTables,
      includePatterns,
      excludePatterns,
    );
  } finally {
    sourceClient.release();
    destClient.release();
  }
}

export async function resolveSchemaTablePatterns(
  sourcePool: Pool,
  destPool: Pool,
  schema: string,
  includePatterns: string[],
  excludePatterns: string[],
): Promise<ResolvedTablePatterns> {
  const [sourceClient, destClient] = await Promise.all([
    sourcePool.connect(),
    destPool.connect(),
  ]);
  try {
    const [sourceTables, destTables] = await Promise.all([
      listTables(sourceClient, schema),
      listTables(destClient, schema),
    ]);
    return resolveTablePatternsFromTableLists(
      sourceTables,
      destTables,
      includePatterns,
      excludePatterns,
      {
        availability: "either",
      },
    );
  } finally {
    sourceClient.release();
    destClient.release();
  }
}

/**
 * Fetches a map of column name -> data_type for the given table.
 * Used by the apply tool to build type-correct WHERE clauses for guards.
 */
export async function fetchColumnTypeMap(
  client: PoolClient,
  schema: string,
  table: string,
): Promise<Record<string, string>> {
  const columns = await fetchColumns(client, schema, table);
  const map: Record<string, string> = {};
  for (const col of columns) {
    map[col.columnName] = col.dataType;
  }
  return map;
}

function resolvePattern(pattern: string, availableTables: string[]): string[] {
  if (!hasWildcard(pattern)) {
    return availableTables.includes(pattern) ? [pattern] : [];
  }
  const matcher = buildWildcardRegex(pattern);
  return availableTables.filter((table) => matcher.test(table));
}

function hasWildcard(pattern: string): boolean {
  return pattern.includes("*");
}

function buildWildcardRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}
