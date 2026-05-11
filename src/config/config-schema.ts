import { z } from "zod";

const ENV_REFERENCE_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*$/;

const envCapableString = z
  .string()
  .min(1, "Value must not be empty")
  .refine(
    (value) => !value.startsWith("$") || ENV_REFERENCE_PATTERN.test(value),
    "Environment variable references must match /^\\$[A-Za-z_][A-Za-z0-9_]*$/",
  );

const envCapablePort = z.union([
  z.number().int().min(1).max(65535),
  z
    .string()
    .regex(
      ENV_REFERENCE_PATTERN,
      "Port env var reference must match /^\\$[A-Za-z_][A-Za-z0-9_]*$/",
    ),
]);

const envCapableBoolean = z.union([
  z.boolean(),
  z
    .string()
    .regex(
      ENV_REFERENCE_PATTERN,
      "Boolean env var reference must match /^\\$[A-Za-z_][A-Za-z0-9_]*$/",
    ),
]);

const envCapableListItem = z
  .string()
  .min(1, "List values must not be empty")
  .refine(
    (value) => !value.startsWith("$") || ENV_REFERENCE_PATTERN.test(value),
    "List env var references must match /^\\$[A-Za-z_][A-Za-z0-9_]*$/",
  );

const tableWhereDataFilters = z.record(
  z.string().min(1, "Table names must not be empty"),
  z
    .string()
    .refine(
      (value) => value.trim().length > 0,
      "SQL WHERE fragments must not be empty",
    ),
);

export const generatorConfigSchema = z.object({
  sourcePgHost: envCapableString,
  sourcePgPort: envCapablePort,
  sourcePgDatabase: envCapableString,
  sourcePgUser: envCapableString,
  sourcePgPassword: envCapableString,
  sourcePgSsl: envCapableBoolean.default(false),

  destPgHost: envCapableString,
  destPgPort: envCapablePort,
  destPgDatabase: envCapableString,
  destPgUser: envCapableString,
  destPgPassword: envCapableString,
  destPgSsl: envCapableBoolean.default(false),

  schema: envCapableString.default("public"),
  tables: z.array(envCapableListItem),
  excludeTables: z.array(envCapableListItem).nullable().default([]),
  schemaDiffTables: z.array(envCapableListItem).optional(),
  schemaDiffExcludeTables: z.array(envCapableListItem).nullable().optional(),
  pgTriggersTables: z.array(envCapableListItem).optional(),
  pgTriggersExcludeTables: z.array(envCapableListItem).nullable().optional(),
  ignoreColumns: z.array(envCapableListItem).nullable().default([]),
  tablesWhereDataFilters: tableWhereDataFilters.optional(),
  includeDeletes: envCapableBoolean.default(true),
  skipMissingPk: envCapableBoolean.default(true),
  output: envCapableString.default("frg-data-diff.json"),
  schemaDiffOutput: envCapableString.optional(),
  pgTriggersOutput: envCapableString.optional(),
  pretty: envCapableBoolean.default(true),
  generateSql: envCapableBoolean.optional(),
  generatePgTriggers: envCapableBoolean.optional(),
});

export const applyConfigSchema = z.object({
  destPgHost: envCapableString,
  destPgPort: envCapablePort,
  destPgDatabase: envCapableString,
  destPgUser: envCapableString,
  destPgPassword: envCapableString,
  destPgSsl: envCapableBoolean.default(false),

  input: envCapableString.default("frg-data-diff.json"),
  dryRun: envCapableBoolean.default(true),
  applyInserts: envCapableBoolean.default(true),
  applyUpdates: envCapableBoolean.default(true),
  applyDeletes: envCapableBoolean.default(false),
  conflictMode: z
    .union([
      z.enum(["abort", "skip", "overwrite"]),
      z
        .string()
        .regex(
          ENV_REFERENCE_PATTERN,
          "Conflict mode env var reference must match /^\\$[A-Za-z_][A-Za-z0-9_]*$/",
        ),
    ])
    .default("abort"),
  insertMode: z
    .union([
      z.enum(["strict", "upsert"]),
      z
        .string()
        .regex(
          ENV_REFERENCE_PATTERN,
          "Insert mode env var reference must match /^\\$[A-Za-z_][A-Za-z0-9_]*$/",
        ),
    ])
    .default("strict"),
  transaction: envCapableBoolean.default(true),
});

export const configSchema = z.object({
  format: z.literal("frg-data-diff-config/v1"),
  generator: generatorConfigSchema,
  apply: applyConfigSchema,
});

export type GeneratorConfig = z.infer<typeof generatorConfigSchema>;
export type ApplyConfig = z.infer<typeof applyConfigSchema>;
export type Config = z.infer<typeof configSchema>;
