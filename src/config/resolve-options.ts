import { type GeneratorConfig, type ApplyConfig } from "./config-schema";
import {
  resolveBooleanValue,
  resolveEnumValue,
  resolveListValues,
  resolveStringValue,
} from "../shared/env-values";

/**
 * Resolved generator options merged from CLI args and config.
 */
export interface ResolvedGeneratorOptions {
  sourcePgHost: string;
  sourcePgPort: number | string;
  sourcePgDatabase: string;
  sourcePgUser: string;
  sourcePgPassword: string;
  sourcePgSsl: boolean | string;

  destPgHost: string;
  destPgPort: number | string;
  destPgDatabase: string;
  destPgUser: string;
  destPgPassword: string;
  destPgSsl: boolean | string;

  schema: string;
  tables: string[];
  excludeTables: string[];
  schemaDiffTables: string[];
  schemaDiffExcludeTables: string[];
  pgTriggersTables: string[];
  pgTriggersExcludeTables: string[];
  ignoreColumns: string[];
  tablesWhereDataFilters?: Record<string, string>;
  includeDeletes: boolean | string;
  skipMissingPk: boolean | string;
  output: string;
  schemaDiffOutput: string;
  pgTriggersOutput: string;
  pretty: boolean | string;
  generateSql?: boolean | string;
  generatePgTriggers?: boolean | string;
  verbose: boolean;
}

export interface RuntimeGeneratorOptions extends Omit<
  ResolvedGeneratorOptions,
  | "sourcePgSsl"
  | "destPgSsl"
  | "includeDeletes"
  | "skipMissingPk"
  | "pretty"
  | "generateSql"
  | "generatePgTriggers"
> {
  sourcePgSsl: boolean;
  destPgSsl: boolean;
  includeDeletes: boolean;
  skipMissingPk: boolean;
  pretty: boolean;
  generateSql?: boolean;
  generatePgTriggers?: boolean;
}

export type OptionalListInput = string[] | null;

export type GeneratorOptionInput = Partial<
  Omit<
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
  }
>;

/**
 * Resolved apply options merged from CLI args and config.
 */
export interface ResolvedApplyOptions {
  destPgHost: string;
  destPgPort: number | string;
  destPgDatabase: string;
  destPgUser: string;
  destPgPassword: string;
  destPgSsl: boolean | string;

  input: string;
  dryRun: boolean | string;
  applyInserts: boolean | string;
  applyUpdates: boolean | string;
  applyDeletes: boolean | string;
  conflictMode: "abort" | "skip" | "overwrite" | string;
  insertMode: "strict" | "upsert" | string;
  transaction: boolean | string;
  verbose: boolean;
}

export interface RuntimeApplyOptions extends Omit<
  ResolvedApplyOptions,
  | "destPgSsl"
  | "dryRun"
  | "applyInserts"
  | "applyUpdates"
  | "applyDeletes"
  | "conflictMode"
  | "insertMode"
  | "transaction"
> {
  destPgSsl: boolean;
  dryRun: boolean;
  applyInserts: boolean;
  applyUpdates: boolean;
  applyDeletes: boolean;
  conflictMode: "abort" | "skip" | "overwrite";
  insertMode: "strict" | "upsert";
  transaction: boolean;
}

/**
 * Merges generator CLI args on top of config values.
 * CLI args take precedence over config values.
 */
export function resolveGeneratorOptions(
  config: GeneratorConfig | undefined,
  cliArgs: GeneratorOptionInput,
): ResolvedGeneratorOptions {
  const defaults: Partial<ResolvedGeneratorOptions> = {
    schema: "public",
    tables: [],
    excludeTables: [],
    schemaDiffTables: [],
    schemaDiffExcludeTables: [],
    pgTriggersTables: [],
    pgTriggersExcludeTables: [],
    ignoreColumns: [],
    tablesWhereDataFilters: {},
    includeDeletes: true,
    skipMissingPk: true,
    output: "frg-data-diff.json",
    schemaDiffOutput: "frg-schema-diff.json",
    pgTriggersOutput: "frg-triggers-diff.sql",
    pretty: true,
    verbose: false,
  };

  const tables = cliArgs.tables ?? config?.tables ?? defaults.tables!;
  const excludeTables = resolveOptionalListOption(
    cliArgs.excludeTables,
    config?.excludeTables,
    defaults.excludeTables!,
  );
  const schemaDiffTables = resolveInheritedTableListOption(
    cliArgs.schemaDiffTables,
    config?.schemaDiffTables,
    tables,
  );
  const schemaDiffExcludeTables = resolveOptionalListOption(
    cliArgs.schemaDiffExcludeTables,
    config?.schemaDiffExcludeTables,
    excludeTables,
  );
  const pgTriggersTables = resolveInheritedTableListOption(
    cliArgs.pgTriggersTables,
    config?.pgTriggersTables,
    tables,
  );
  const pgTriggersExcludeTables = resolveOptionalListOption(
    cliArgs.pgTriggersExcludeTables,
    config?.pgTriggersExcludeTables,
    excludeTables,
  );
  const ignoreColumns = resolveOptionalListOption(
    cliArgs.ignoreColumns,
    config?.ignoreColumns,
    defaults.ignoreColumns!,
  );

  return {
    sourcePgHost: cliArgs.sourcePgHost ?? config?.sourcePgHost ?? "",
    sourcePgPort: cliArgs.sourcePgPort ?? config?.sourcePgPort ?? 5432,
    sourcePgDatabase:
      cliArgs.sourcePgDatabase ?? config?.sourcePgDatabase ?? "",
    sourcePgUser: cliArgs.sourcePgUser ?? config?.sourcePgUser ?? "",
    sourcePgPassword:
      cliArgs.sourcePgPassword ?? config?.sourcePgPassword ?? "",
    sourcePgSsl: cliArgs.sourcePgSsl ?? config?.sourcePgSsl ?? false,

    destPgHost: cliArgs.destPgHost ?? config?.destPgHost ?? "",
    destPgPort: cliArgs.destPgPort ?? config?.destPgPort ?? 5432,
    destPgDatabase: cliArgs.destPgDatabase ?? config?.destPgDatabase ?? "",
    destPgUser: cliArgs.destPgUser ?? config?.destPgUser ?? "",
    destPgPassword: cliArgs.destPgPassword ?? config?.destPgPassword ?? "",
    destPgSsl: cliArgs.destPgSsl ?? config?.destPgSsl ?? false,

    schema: cliArgs.schema ?? config?.schema ?? defaults.schema!,
    tables,
    excludeTables,
    schemaDiffTables,
    schemaDiffExcludeTables,
    pgTriggersTables,
    pgTriggersExcludeTables,
    ignoreColumns,
    tablesWhereDataFilters:
      cliArgs.tablesWhereDataFilters ??
      config?.tablesWhereDataFilters ??
      defaults.tablesWhereDataFilters!,
    includeDeletes:
      cliArgs.includeDeletes ??
      config?.includeDeletes ??
      defaults.includeDeletes!,
    skipMissingPk:
      cliArgs.skipMissingPk ?? config?.skipMissingPk ?? defaults.skipMissingPk!,
    output: cliArgs.output ?? config?.output ?? defaults.output!,
    schemaDiffOutput:
      cliArgs.schemaDiffOutput ??
      config?.schemaDiffOutput ??
      defaults.schemaDiffOutput!,
    pgTriggersOutput:
      cliArgs.pgTriggersOutput ??
      config?.pgTriggersOutput ??
      defaults.pgTriggersOutput!,
    pretty: cliArgs.pretty ?? config?.pretty ?? defaults.pretty!,
    generateSql: cliArgs.generateSql ?? config?.generateSql,
    generatePgTriggers:
      cliArgs.generatePgTriggers ?? config?.generatePgTriggers,
    verbose: cliArgs.verbose ?? defaults.verbose!,
  };
}

function resolveOptionalListOption(
  cliValue: OptionalListInput | undefined,
  configValue: OptionalListInput | undefined,
  fallback: string[],
): string[] {
  if (cliValue !== undefined) {
    return cliValue ?? [];
  }
  if (configValue !== undefined) {
    return configValue ?? [];
  }
  return fallback;
}

function resolveInheritedTableListOption(
  cliValue: string[] | undefined,
  configValue: string[] | undefined,
  fallback: string[],
): string[] {
  if (cliValue !== undefined && cliValue.length > 0) {
    return cliValue;
  }

  if (configValue !== undefined && configValue.length > 0) {
    return configValue;
  }

  return fallback;
}

/**
 * Merges apply CLI args on top of config values.
 * CLI args take precedence over config values.
 */
export function resolveApplyOptions(
  config: ApplyConfig | undefined,
  cliArgs: Partial<ResolvedApplyOptions>,
): ResolvedApplyOptions {
  const defaults: Partial<ResolvedApplyOptions> = {
    input: "frg-data-diff.json",
    dryRun: true,
    applyInserts: true,
    applyUpdates: true,
    applyDeletes: false,
    conflictMode: "abort",
    insertMode: "strict",
    transaction: true,
    verbose: false,
  };

  return {
    destPgHost: cliArgs.destPgHost ?? config?.destPgHost ?? "",
    destPgPort: cliArgs.destPgPort ?? config?.destPgPort ?? 5432,
    destPgDatabase: cliArgs.destPgDatabase ?? config?.destPgDatabase ?? "",
    destPgUser: cliArgs.destPgUser ?? config?.destPgUser ?? "",
    destPgPassword: cliArgs.destPgPassword ?? config?.destPgPassword ?? "",
    destPgSsl: cliArgs.destPgSsl ?? config?.destPgSsl ?? false,

    input: cliArgs.input ?? config?.input ?? defaults.input!,
    dryRun: cliArgs.dryRun ?? config?.dryRun ?? defaults.dryRun!,
    applyInserts:
      cliArgs.applyInserts ?? config?.applyInserts ?? defaults.applyInserts!,
    applyUpdates:
      cliArgs.applyUpdates ?? config?.applyUpdates ?? defaults.applyUpdates!,
    applyDeletes:
      cliArgs.applyDeletes ?? config?.applyDeletes ?? defaults.applyDeletes!,
    conflictMode:
      cliArgs.conflictMode ?? config?.conflictMode ?? defaults.conflictMode!,
    insertMode:
      cliArgs.insertMode ?? config?.insertMode ?? defaults.insertMode!,
    transaction:
      cliArgs.transaction ?? config?.transaction ?? defaults.transaction!,
    verbose: cliArgs.verbose ?? defaults.verbose!,
  };
}

export function resolveRuntimeGeneratorOptions(
  options: ResolvedGeneratorOptions,
): RuntimeGeneratorOptions {
  let generateSql: boolean | undefined;
  if (options.generateSql !== undefined) {
    generateSql = resolveBooleanValue(options.generateSql, "generate sql");
  }

  let generatePgTriggers: boolean | undefined;
  if (options.generatePgTriggers !== undefined) {
    generatePgTriggers = resolveBooleanValue(
      options.generatePgTriggers,
      "generate pg triggers",
    );
  }

  return {
    ...options,
    schema: resolveStringValue(options.schema, "schema"),
    tables: resolveListValues(options.tables, "tables"),
    excludeTables: resolveListValues(options.excludeTables, "exclude tables"),
    schemaDiffTables: resolveListValues(
      options.schemaDiffTables,
      "schema diff tables",
    ),
    schemaDiffExcludeTables: resolveListValues(
      options.schemaDiffExcludeTables,
      "schema diff exclude tables",
    ),
    pgTriggersTables: resolveListValues(
      options.pgTriggersTables,
      "pg triggers tables",
    ),
    pgTriggersExcludeTables: resolveListValues(
      options.pgTriggersExcludeTables,
      "pg triggers exclude tables",
    ),
    ignoreColumns: resolveListValues(options.ignoreColumns, "ignored columns"),
    sourcePgSsl: resolveBooleanValue(options.sourcePgSsl, "source ssl"),
    destPgSsl: resolveBooleanValue(options.destPgSsl, "destination ssl"),
    includeDeletes: resolveBooleanValue(
      options.includeDeletes,
      "include deletes",
    ),
    skipMissingPk: resolveBooleanValue(
      options.skipMissingPk,
      "skip missing primary keys",
    ),
    output: resolveStringValue(options.output, "output file"),
    schemaDiffOutput: resolveStringValue(
      options.schemaDiffOutput,
      "schema diff output file",
    ),
    pgTriggersOutput: resolveStringValue(
      options.pgTriggersOutput,
      "pg triggers output file",
    ),
    pretty: resolveBooleanValue(options.pretty, "pretty-print json"),
    generateSql,
    generatePgTriggers,
  };
}

export function resolveRuntimeApplyOptions(
  options: ResolvedApplyOptions,
): RuntimeApplyOptions {
  return {
    ...options,
    destPgSsl: resolveBooleanValue(options.destPgSsl, "destination ssl"),
    input: resolveStringValue(options.input, "input file"),
    dryRun: resolveBooleanValue(options.dryRun, "dry-run"),
    applyInserts: resolveBooleanValue(options.applyInserts, "apply inserts"),
    applyUpdates: resolveBooleanValue(options.applyUpdates, "apply updates"),
    applyDeletes: resolveBooleanValue(options.applyDeletes, "apply deletes"),
    conflictMode: resolveEnumValue(options.conflictMode, "conflict mode", [
      "abort",
      "skip",
      "overwrite",
    ]),
    insertMode: resolveEnumValue(options.insertMode, "insert mode", [
      "strict",
      "upsert",
    ]),
    transaction: resolveBooleanValue(options.transaction, "transaction"),
  };
}
