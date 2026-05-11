import { type PoolClient } from "pg";

export interface TriggerInfo {
  triggerName: string;
  triggerDefinition: string;
}

export interface FunctionInfo {
  functionSchema: string;
  functionName: string;
  functionDefinition: string;
}

export interface TableTriggersAndFunctions {
  table: string;
  triggers: TriggerInfo[];
  functions: FunctionInfo[];
}

export interface FetchTriggersAndFunctionsForTablesOptions {
  onTableStart?: (
    table: string,
    tablePosition: number,
    totalTables: number,
  ) => void;
}

/**
 * Fetches user-defined triggers and their associated functions for a given table.
 */
export async function fetchTriggersAndFunctions(
  client: PoolClient,
  schema: string,
  table: string,
): Promise<TableTriggersAndFunctions> {
  const result = await client.query<{
    trigger_name: string;
    trigger_definition: string;
    function_schema: string;
    function_name: string;
    function_definition: string;
  }>(
    `
    SELECT
      trg.tgname AS trigger_name,
      pg_get_triggerdef(trg.oid) AS trigger_definition,
      proc_ns.nspname AS function_schema,
      proc.proname AS function_name,
      pg_get_functiondef(proc.oid) AS function_definition
    FROM pg_trigger trg
    JOIN pg_class tbl ON tbl.oid = trg.tgrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_proc proc ON proc.oid = trg.tgfoid
    JOIN pg_namespace proc_ns ON proc_ns.oid = proc.pronamespace
    WHERE ns.nspname = $1
      AND tbl.relname = $2
      AND trg.tgisinternal = false
    ORDER BY trg.tgname
    `,
    [schema, table],
  );

  const triggers: TriggerInfo[] = [];
  const functions: FunctionInfo[] = [];
  const seenFunctions = new Set<string>();

  for (const row of result.rows) {
    triggers.push({
      triggerName: row.trigger_name,
      triggerDefinition: row.trigger_definition,
    });

    const funcKey = `${row.function_schema}.${row.function_name}`;
    if (!seenFunctions.has(funcKey)) {
      seenFunctions.add(funcKey);
      functions.push({
        functionSchema: row.function_schema,
        functionName: row.function_name,
        functionDefinition: row.function_definition,
      });
    }
  }

  return { table, triggers, functions };
}

/**
 * Fetches triggers and functions for a list of tables.
 */
export async function fetchTriggersAndFunctionsForTables(
  client: PoolClient,
  schema: string,
  tables: string[],
  options: FetchTriggersAndFunctionsForTablesOptions = {},
): Promise<TableTriggersAndFunctions[]> {
  const results: TableTriggersAndFunctions[] = [];

  for (const [tableIndex, table] of tables.entries()) {
    if (options.onTableStart) {
      options.onTableStart(table, tableIndex + 1, tables.length);
    }

    results.push(await fetchTriggersAndFunctions(client, schema, table));
  }

  return results;
}
