import { describe, it, expect } from "vitest";
import {
  configSchema,
  generatorConfigSchema,
  applyConfigSchema,
} from "../../src/config/config-schema";

const validGeneratorConfig = {
  sourcePgHost: "dev-db.example.com",
  sourcePgPort: 5432,
  sourcePgDatabase: "app",
  sourcePgUser: "app_user",
  sourcePgPassword: "$PG_PASSWORD_DEV",
  sourcePgSsl: true,
  destPgHost: "prod-db.example.com",
  destPgPort: 5432,
  destPgDatabase: "app",
  destPgUser: "app_user",
  destPgPassword: "$PG_PASSWORD_PROD",
  destPgSsl: false,
  schema: "public",
  tables: ["directus_collections"],
  excludeTables: [],
  schemaDiffTables: ["directus_fields"],
  schemaDiffExcludeTables: ["directus_revisions"],
  pgTriggersTables: ["directus_flows"],
  pgTriggersExcludeTables: ["directus_sessions"],
  pgViews: ["directus_view"],
  pgViewsExclude: ["directus_legacy_view"],
  ignoreColumns: [],
  tablesWhereDataFilters: {
    directus_presets: '"user" IS NULL',
  },
  includeDeletes: true,
  skipMissingPk: false,
  output: "frg-data-diff.json",
  schemaDiffOutput: "frg-schema-diff.json",
  pgTriggersOutput: "frg-triggers-diff.sql",
  pgViewsOutput: "frg-views-diff.sql",
  pretty: true,
  generateSql: true,
};

const validApplyConfig = {
  destPgHost: "prod-db.example.com",
  destPgPort: 5432,
  destPgDatabase: "app",
  destPgUser: "app_user",
  destPgPassword: "$PG_PASSWORD_PROD",
  destPgSsl: false,
  input: "frg-data-diff.json",
  dryRun: true,
  applyInserts: true,
  applyUpdates: true,
  applyDeletes: false,
  conflictMode: "abort" as const,
  insertMode: "strict" as const,
  transaction: true,
};

const validConfig = {
  format: "frg-data-diff-config/v1",
  generator: validGeneratorConfig,
  apply: validApplyConfig,
};

describe("configSchema", () => {
  it("validates a correct config", () => {
    const result = configSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("rejects wrong format string", () => {
    const result = configSchema.safeParse({
      ...validConfig,
      format: "wrong-format",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing format", () => {
    const { format: _, ...rest } = validConfig;
    const result = configSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("requires generator section", () => {
    const { generator: _, ...rest } = validConfig;
    const result = configSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("requires apply section", () => {
    const { apply: _, ...rest } = validConfig;
    const result = configSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("generatorConfigSchema", () => {
  it("accepts valid generator config", () => {
    const result = generatorConfigSchema.safeParse(validGeneratorConfig);
    expect(result.success).toBe(true);
  });

  it("accepts plain text password values", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      sourcePgPassword: "plain-password",
    });
    expect(result.success).toBe(true);
  });

  it("accepts lowercase and camelCase env references", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      sourcePgHost: "$sourceHost",
      sourcePgPassword: "$pgPasswordDev",
      destPgPassword: "$dest_password",
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed env references", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      sourcePgPassword: "$bad-name",
    });
    expect(result.success).toBe(false);
  });

  it("accepts env-backed ports", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      sourcePgPort: "$SOURCE_PORT",
    });
    expect(result.success).toBe(true);
  });

  it("accepts env-backed list values", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      tables: ["$tableFilter"],
      excludeTables: ["$excludedTables"],
      schemaDiffTables: ["$schemaTableFilter"],
      schemaDiffExcludeTables: ["$schemaExcludedTables"],
      pgTriggersTables: ["$pgTriggersTableFilter"],
      pgTriggersExcludeTables: ["$pgTriggersExcludedTables"],
      pgViews: ["$pgViewsFilter"],
      pgViewsExclude: ["$pgViewsExcluded"],
      ignoreColumns: ["$ignoredColumns"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts null optional lists as an explicit clear value", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      excludeTables: null,
      schemaDiffExcludeTables: null,
      pgTriggersExcludeTables: null,
      pgViewsExclude: null,
      ignoreColumns: null,
    });
    expect(result.success).toBe(true);
  });

  it("allows tablesWhereDataFilters to be omitted", () => {
    const { tablesWhereDataFilters: _, ...rest } = validGeneratorConfig;
    const result = generatorConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tablesWhereDataFilters).toBeUndefined();
    }
  });

  it("rejects empty tablesWhereDataFilters SQL fragments", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      tablesWhereDataFilters: {
        directus_presets: "   ",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string tablesWhereDataFilters values", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      tablesWhereDataFilters: {
        directus_presets: null,
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts env-backed generator scalar values and booleans", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      sourcePgSsl: "$sourceSsl",
      destPgSsl: "$destSsl",
      schema: "$schemaName",
      includeDeletes: "$includeDeletes",
      skipMissingPk: "$skipMissingPk",
      output: "$outputFile",
      schemaDiffOutput: "$schemaOutputFile",
      pgTriggersOutput: "$pgTriggersOutputFile",
      pgViewsOutput: "$pgViewsOutputFile",
      pretty: "$prettyJson",
      generateSql: "$generateSql",
      generatePgViews: "$generatePgViews",
    });
    expect(result.success).toBe(true);
  });

  it("allows generateSql to be omitted", () => {
    const { generateSql: _, ...rest } = validGeneratorConfig;
    const result = generatorConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.generateSql).toBeUndefined();
    }
  });

  it("rejects malformed env-backed list values", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      tables: ["$bad-table-filter"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects port out of range", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      sourcePgPort: 99999,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer port", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      sourcePgPort: 5432.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-array tables", () => {
    const result = generatorConfigSchema.safeParse({
      ...validGeneratorConfig,
      tables: "not_an_array",
    });
    expect(result.success).toBe(false);
  });

  it("applies default schema of public", () => {
    const { schema: _, ...rest } = validGeneratorConfig;
    const result = generatorConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema).toBe("public");
    }
  });

  it("applies default includeDeletes of true", () => {
    const { includeDeletes: _, ...rest } = validGeneratorConfig;
    const result = generatorConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeDeletes).toBe(true);
    }
  });

  it("applies default skipMissingPk of true", () => {
    const { skipMissingPk: _, ...rest } = validGeneratorConfig;
    const result = generatorConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skipMissingPk).toBe(true);
    }
  });
});

describe("applyConfigSchema", () => {
  it("accepts valid apply config", () => {
    const result = applyConfigSchema.safeParse(validApplyConfig);
    expect(result.success).toBe(true);
  });

  it("rejects invalid conflictMode", () => {
    const result = applyConfigSchema.safeParse({
      ...validApplyConfig,
      conflictMode: "force",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid insertMode", () => {
    const result = applyConfigSchema.safeParse({
      ...validApplyConfig,
      insertMode: "replace",
    });
    expect(result.success).toBe(false);
  });

  it("defaults applyDeletes to false", () => {
    const { applyDeletes: _, ...rest } = validApplyConfig;
    const result = applyConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.applyDeletes).toBe(false);
    }
  });

  it("defaults dryRun to true", () => {
    const { dryRun: _, ...rest } = validApplyConfig;
    const result = applyConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dryRun).toBe(true);
    }
  });

  it("accepts all valid conflictMode values", () => {
    for (const mode of ["abort", "skip", "overwrite"] as const) {
      const result = applyConfigSchema.safeParse({
        ...validApplyConfig,
        conflictMode: mode,
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts all valid insertMode values", () => {
    for (const mode of ["strict", "upsert"] as const) {
      const result = applyConfigSchema.safeParse({
        ...validApplyConfig,
        insertMode: mode,
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts env-backed apply scalar values, booleans, and enums", () => {
    const result = applyConfigSchema.safeParse({
      ...validApplyConfig,
      destPgSsl: "$destSsl",
      input: "$inputFile",
      dryRun: "$dryRun",
      applyInserts: "$applyInserts",
      applyUpdates: "$applyUpdates",
      applyDeletes: "$applyDeletes",
      conflictMode: "$conflictMode",
      insertMode: "$insertMode",
      transaction: "$transaction",
    });
    expect(result.success).toBe(true);
  });
});
