import * as fs from "fs";
import {
  type ResolvedGeneratorOptions,
  type ResolvedApplyOptions,
  type OptionalListInput,
} from "./resolve-options";

type WritableGeneratorOptions = Omit<
  ResolvedGeneratorOptions,
  | "excludeTables"
  | "schemaDiffExcludeTables"
  | "pgTriggersExcludeTables"
  | "ignoreColumns"
> & {
  excludeTables: OptionalListInput;
  schemaDiffExcludeTables: OptionalListInput;
  pgTriggersExcludeTables: OptionalListInput;
  ignoreColumns: OptionalListInput;
};

/**
 * Builds a config object from resolved generator and apply options.
 * Values may be plain text or $ENV_VAR references, depending on user input.
 */
export function buildConfigFile(
  generatorOptions: WritableGeneratorOptions,
  applyOptions: ResolvedApplyOptions,
): object {
  const generator: Record<string, unknown> = {
    sourcePgHost: generatorOptions.sourcePgHost,
    sourcePgPort: generatorOptions.sourcePgPort,
    sourcePgDatabase: generatorOptions.sourcePgDatabase,
    sourcePgUser: generatorOptions.sourcePgUser,
    sourcePgPassword: generatorOptions.sourcePgPassword,
    sourcePgSsl: generatorOptions.sourcePgSsl,

    destPgHost: generatorOptions.destPgHost,
    destPgPort: generatorOptions.destPgPort,
    destPgDatabase: generatorOptions.destPgDatabase,
    destPgUser: generatorOptions.destPgUser,
    destPgPassword: generatorOptions.destPgPassword,
    destPgSsl: generatorOptions.destPgSsl,

    schema: generatorOptions.schema,
    tables: generatorOptions.tables,
    tablesWhereDataFilters: generatorOptions.tablesWhereDataFilters ?? {},
    excludeTables: generatorOptions.excludeTables ?? [],
    schemaDiffTables: generatorOptions.schemaDiffTables,
    schemaDiffExcludeTables: generatorOptions.schemaDiffExcludeTables ?? [],
    pgTriggersTables: generatorOptions.pgTriggersTables,
    pgTriggersExcludeTables: generatorOptions.pgTriggersExcludeTables ?? [],
    ignoreColumns: generatorOptions.ignoreColumns ?? [],
    includeDeletes: generatorOptions.includeDeletes,
    skipMissingPk: generatorOptions.skipMissingPk,
    output: generatorOptions.output,
    schemaDiffOutput: generatorOptions.schemaDiffOutput,
    pgTriggersOutput: generatorOptions.pgTriggersOutput,
    pretty: generatorOptions.pretty,
    generateSql: generatorOptions.generateSql,
    generatePgTriggers: generatorOptions.generatePgTriggers,
  };

  return {
    format: "frg-data-diff-config/v1",
    generator,
    apply: {
      destPgHost: applyOptions.destPgHost,
      destPgPort: applyOptions.destPgPort,
      destPgDatabase: applyOptions.destPgDatabase,
      destPgUser: applyOptions.destPgUser,
      destPgPassword: applyOptions.destPgPassword,
      destPgSsl: applyOptions.destPgSsl,

      input: applyOptions.input,
      dryRun: applyOptions.dryRun,
      applyInserts: applyOptions.applyInserts,
      applyUpdates: applyOptions.applyUpdates,
      applyDeletes: applyOptions.applyDeletes,
      conflictMode: applyOptions.conflictMode,
      insertMode: applyOptions.insertMode,
      transaction: applyOptions.transaction,
    },
  };
}

/**
 * Writes the config object to the given path as formatted JSON.
 */
export function writeConfig(configPath: string, config: object): void {
  const content = JSON.stringify(config, null, 2) + "\n";
  fs.writeFileSync(configPath, content, "utf-8");
}
