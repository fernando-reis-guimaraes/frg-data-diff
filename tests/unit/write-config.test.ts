import { describe, it, expect } from "vitest";
import { buildConfigFile } from "../../src/config/write-config";
import type {
  ResolvedGeneratorOptions,
  ResolvedApplyOptions,
} from "../../src/config/resolve-options";

const generatorOpts: ResolvedGeneratorOptions = {
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
  tables: ["my_table"],
  excludeTables: [],
  schemaDiffTables: ["my_schema_table"],
  schemaDiffExcludeTables: ["legacy_schema_table"],
  pgTriggersTables: ["my_trigger_table"],
  pgTriggersExcludeTables: ["legacy_trigger_table"],
  ignoreColumns: [],
  includeDeletes: true,
  skipMissingPk: false,
  output: "frg-data-diff.json",
  schemaDiffOutput: "frg-schema-diff.json",
  pgTriggersOutput: "frg-triggers-diff.sql",
  pretty: true,
  generateSql: true,
  verbose: false,
};

const applyOpts: ResolvedApplyOptions = {
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
  conflictMode: "abort",
  insertMode: "strict",
  transaction: true,
  verbose: false,
};

describe("buildConfigFile", () => {
  it("produces a config with the correct format", () => {
    const config = buildConfigFile(generatorOpts, applyOpts) as Record<
      string,
      unknown
    >;
    expect(config["format"]).toBe("frg-data-diff-config/v1");
  });

  it("preserves the configured connection values", () => {
    const config = buildConfigFile(generatorOpts, applyOpts) as {
      generator: Record<string, unknown>;
      apply: Record<string, unknown>;
    };
    expect(config.generator["sourcePgPassword"]).toBe("$PG_PASSWORD_DEV");
    expect(config.generator["destPgPassword"]).toBe("$PG_PASSWORD_PROD");
    expect(config.apply["destPgPassword"]).toBe("$PG_PASSWORD_PROD");
  });

  it("does not include verbose field in output", () => {
    const config = buildConfigFile(generatorOpts, applyOpts) as {
      generator: Record<string, unknown>;
      apply: Record<string, unknown>;
    };
    expect(config.generator["verbose"]).toBeUndefined();
    expect(config.apply["verbose"]).toBeUndefined();
  });

  it("includes all required generator fields", () => {
    const config = buildConfigFile(generatorOpts, applyOpts) as {
      generator: Record<string, unknown>;
    };
    const g = config.generator;
    expect(g["sourcePgHost"]).toBe("dev-db.example.com");
    expect(g["tables"]).toEqual(["my_table"]);
    expect(g["schema"]).toBe("public");
    expect(g["schemaDiffTables"]).toEqual(["my_schema_table"]);
    expect(g["schemaDiffExcludeTables"]).toEqual(["legacy_schema_table"]);
    expect(g["pgTriggersTables"]).toEqual(["my_trigger_table"]);
    expect(g["pgTriggersExcludeTables"]).toEqual(["legacy_trigger_table"]);
    expect(g["includeDeletes"]).toBe(true);
    expect(g["sourcePgSsl"]).toBe(true);
    expect(g["destPgSsl"]).toBe(false);
    expect(g["schemaDiffOutput"]).toBe("frg-schema-diff.json");
    expect(g["pgTriggersOutput"]).toBe("frg-triggers-diff.sql");
    expect(g["generateSql"]).toBe(true);
  });

  it("preserves raw table patterns in config output", () => {
    const config = buildConfigFile(
      {
        ...generatorOpts,
        tables: ["directus_*"],
        excludeTables: ["*_sessions"],
        schemaDiffTables: ["directus_schema_*"],
        schemaDiffExcludeTables: ["*_relations"],
        pgTriggersTables: ["directus_flows"],
        pgTriggersExcludeTables: ["*_sessions"],
      },
      applyOpts,
    ) as {
      generator: Record<string, unknown>;
    };

    expect(config.generator["tables"]).toEqual(["directus_*"]);
    expect(config.generator["excludeTables"]).toEqual(["*_sessions"]);
    expect(config.generator["schemaDiffTables"]).toEqual(["directus_schema_*"]);
    expect(config.generator["schemaDiffExcludeTables"]).toEqual([
      "*_relations",
    ]);
    expect(config.generator["pgTriggersTables"]).toEqual(["directus_flows"]);
    expect(config.generator["pgTriggersExcludeTables"]).toEqual(["*_sessions"]);
  });

  it("writes empty arrays for null optional lists", () => {
    const config = buildConfigFile(
      {
        ...generatorOpts,
        excludeTables: null,
        schemaDiffExcludeTables: null,
        pgTriggersExcludeTables: null,
        ignoreColumns: null,
      },
      applyOpts,
    ) as {
      generator: Record<string, unknown>;
    };

    expect(config.generator["excludeTables"]).toEqual([]);
    expect(config.generator["schemaDiffExcludeTables"]).toEqual([]);
    expect(config.generator["pgTriggersExcludeTables"]).toEqual([]);
    expect(config.generator["ignoreColumns"]).toEqual([]);
  });

  it("preserves tablesWhereDataFilters when configured", () => {
    const config = buildConfigFile(
      {
        ...generatorOpts,
        tablesWhereDataFilters: {
          directus_presets: '"user" IS NULL',
        },
      },
      applyOpts,
    ) as {
      generator: Record<string, unknown>;
    };

    expect(config.generator["tablesWhereDataFilters"]).toEqual({
      directus_presets: '"user" IS NULL',
    });
  });

  it("writes an empty tablesWhereDataFilters object when it is not configured", () => {
    const config = buildConfigFile(
      {
        ...generatorOpts,
        tablesWhereDataFilters: {},
      },
      applyOpts,
    ) as {
      generator: Record<string, unknown>;
    };

    expect(config.generator["tablesWhereDataFilters"]).toEqual({});
  });

  it("includes all required apply fields", () => {
    const config = buildConfigFile(generatorOpts, applyOpts) as {
      apply: Record<string, unknown>;
    };
    const a = config.apply;
    expect(a["dryRun"]).toBe(true);
    expect(a["applyDeletes"]).toBe(false);
    expect(a["conflictMode"]).toBe("abort");
    expect(a["insertMode"]).toBe("strict");
    expect(a["destPgSsl"]).toBe(false);
  });
});
