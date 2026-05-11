import { type Pool } from "pg";
import { resolveTablePatterns } from "../db/metadata";
import {
  fetchTriggersAndFunctionsForTables,
  type FunctionInfo,
  type TriggerInfo,
} from "../db/pg-triggers";

export interface GeneratePgTriggersDiffOptions {
  schema: string;
  tables: string[];
  excludeTables: string[];
  verbose: boolean;
  onProgress?: (message: string) => void;
  onVerboseProgress?: (message: string) => void;
}

export async function generatePgTriggersDiffSql(
  sourcePool: Pool,
  destPool: Pool,
  options: GeneratePgTriggersDiffOptions,
): Promise<string> {
  reportProgress(
    options.onProgress,
    "PostgreSQL triggers: resolving requested table patterns",
  );

  const { tables } = await resolveTablePatterns(
    sourcePool,
    destPool,
    options.schema,
    options.tables,
    options.excludeTables,
  );

  reportProgress(
    options.onProgress,
    `PostgreSQL triggers: comparing ${tables.length} table(s)`,
  );

  const sourceClient = await sourcePool.connect();
  const destClient = await destPool.connect();

  let sql = `-- PostgreSQL Triggers and Functions Diff\n`;
  sql += `-- Generated automatically\n\n`;

  try {
    reportProgress(
      options.onProgress,
      "PostgreSQL triggers: fetching trigger and function definitions from source",
    );

    const sourceData = await fetchTriggersAndFunctionsForTables(
      sourceClient,
      options.schema,
      tables,
      {
        onTableStart: (table, tablePosition, totalTables) => {
          reportProgress(
            options.onProgress,
            `[pg-triggers source ${tablePosition}/${totalTables}] ${options.schema}.${table}: fetching definitions`,
          );
        },
      },
    );

    reportProgress(
      options.onProgress,
      "PostgreSQL triggers: fetching trigger and function definitions from destination",
    );

    const destData = await fetchTriggersAndFunctionsForTables(
      destClient,
      options.schema,
      tables,
      {
        onTableStart: (table, tablePosition, totalTables) => {
          reportProgress(
            options.onProgress,
            `[pg-triggers dest ${tablePosition}/${totalTables}] ${options.schema}.${table}: fetching definitions`,
          );
        },
      },
    );

    const sourceTablesMap = new Map(sourceData.map((d) => [d.table, d]));
    const destTablesMap = new Map(destData.map((d) => [d.table, d]));

    const allAddedFunctions: FunctionInfo[] = [];
    const allDroppedFunctions: FunctionInfo[] = [];
    const allAddedTriggers: TriggerInfo[] = [];
    const allDroppedTriggers: { table: string; triggerName: string }[] = [];

    const sourceFunctionsMap = new Map<string, FunctionInfo>();
    const destFunctionsMap = new Map<string, FunctionInfo>();

    reportProgress(
      options.onProgress,
      "PostgreSQL triggers: indexing function definitions",
    );

    for (const data of sourceData) {
      for (const fn of data.functions) {
        sourceFunctionsMap.set(`${fn.functionSchema}.${fn.functionName}`, fn);
      }
    }
    for (const data of destData) {
      for (const fn of data.functions) {
        destFunctionsMap.set(`${fn.functionSchema}.${fn.functionName}`, fn);
      }
    }

    // Determine function diffs globally across the requested tables
    for (const [key, sourceFn] of sourceFunctionsMap) {
      const destFn = destFunctionsMap.get(key);
      if (
        !destFn ||
        destFn.functionDefinition !== sourceFn.functionDefinition
      ) {
        allAddedFunctions.push(sourceFn);
      }
    }
    for (const [key, destFn] of destFunctionsMap) {
      const sourceFn = sourceFunctionsMap.get(key);
      if (!sourceFn) {
        allDroppedFunctions.push(destFn);
      }
    }

    reportProgress(
      options.onProgress,
      `PostgreSQL functions: ${allAddedFunctions.length} function(s) to create or replace, ${allDroppedFunctions.length} function(s) to drop`,
    );

    // Determine trigger diffs per table
    for (const [tableIndex, table] of tables.entries()) {
      const progressLabel = formatPgTriggersProgressLabel(
        tableIndex + 1,
        tables.length,
        options.schema,
        table,
      );
      const sourceMeta = sourceTablesMap.get(table);
      const destMeta = destTablesMap.get(table);

      const sourceTriggersMap = new Map(
        sourceMeta?.triggers.map((t) => [t.triggerName, t]) ?? [],
      );
      const destTriggersMap = new Map(
        destMeta?.triggers.map((t) => [t.triggerName, t]) ?? [],
      );

      let addedTriggersForTable = 0;
      let droppedTriggersForTable = 0;

      reportProgress(
        options.onProgress,
        `${progressLabel}: comparing triggers`,
      );

      for (const [triggerName, sourceTrigger] of sourceTriggersMap) {
        const destTrigger = destTriggersMap.get(triggerName);
        if (
          !destTrigger ||
          destTrigger.triggerDefinition !== sourceTrigger.triggerDefinition
        ) {
          if (destTrigger) {
            allDroppedTriggers.push({ table, triggerName });
            droppedTriggersForTable++;
          }
          allAddedTriggers.push(sourceTrigger);
          addedTriggersForTable++;
        }
      }

      for (const [triggerName] of destTriggersMap) {
        if (!sourceTriggersMap.has(triggerName)) {
          allDroppedTriggers.push({ table, triggerName });
          droppedTriggersForTable++;
        }
      }

      reportProgress(
        options.onProgress,
        `${progressLabel}: ${addedTriggersForTable} trigger(s) to create or replace, ${droppedTriggersForTable} trigger(s) to drop`,
      );
    }

    // Generate SQL
    if (
      allDroppedTriggers.length === 0 &&
      allDroppedFunctions.length === 0 &&
      allAddedFunctions.length === 0 &&
      allAddedTriggers.length === 0
    ) {
      reportProgress(
        options.onProgress,
        "PostgreSQL triggers: no differences found",
      );
      sql += `-- No differences found.\n`;
      return sql;
    }

    reportProgress(
      options.onProgress,
      "PostgreSQL triggers: generating SQL script",
    );

    // We must drop triggers before dropping functions, otherwise it's a dependency violation
    if (allDroppedTriggers.length > 0) {
      sql += `-- Drop removed or modified triggers\n`;
      for (const drop of allDroppedTriggers) {
        sql += `DROP TRIGGER IF EXISTS "${drop.triggerName}" ON "${options.schema}"."${drop.table}";\n`;
      }
      sql += `\n`;
    }

    if (allDroppedFunctions.length > 0) {
      sql += `-- Drop removed functions\n`;
      for (const drop of allDroppedFunctions) {
        sql += `DROP FUNCTION IF EXISTS "${drop.functionSchema}"."${drop.functionName}"();\n`;
      }
      sql += `\n`;
    }

    if (allAddedFunctions.length > 0) {
      sql += `-- Create or replace functions\n`;
      for (const fn of allAddedFunctions) {
        let def = fn.functionDefinition.trim();
        if (def.toUpperCase().startsWith("CREATE FUNCTION")) {
          def =
            "CREATE OR REPLACE FUNCTION" +
            def.substring("CREATE FUNCTION".length);
        }
        if (!def.endsWith(";")) {
          def += ";";
        }
        sql += `${def}\n\n`;
      }
    }

    if (allAddedTriggers.length > 0) {
      sql += `-- Create new or modified triggers\n`;
      for (const trg of allAddedTriggers) {
        let def = trg.triggerDefinition.trim();
        if (def.toUpperCase().startsWith("CREATE TRIGGER")) {
          def =
            "CREATE OR REPLACE TRIGGER" +
            def.substring("CREATE TRIGGER".length);
        }
        if (!def.endsWith(";")) {
          def += ";";
        }
        sql += `${def}\n\n`;
      }
    }
  } finally {
    sourceClient.release();
    destClient.release();
  }

  return sql;
}

function formatPgTriggersProgressLabel(
  tablePosition: number,
  totalTables: number,
  schema: string,
  table: string,
): string {
  return `[pg-triggers ${tablePosition}/${totalTables}] ${schema}.${table}`;
}

function reportProgress(
  callback: ((message: string) => void) | undefined,
  message: string,
): void {
  if (callback) {
    callback(message);
  }
}
