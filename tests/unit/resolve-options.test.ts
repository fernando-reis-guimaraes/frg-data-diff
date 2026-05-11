import { describe, it, expect } from "vitest";
import {
  resolveApplyOptions,
  resolveGeneratorOptions,
  resolveRuntimeApplyOptions,
  resolveRuntimeGeneratorOptions,
} from "../../src/config/resolve-options";
import type {
  GeneratorConfig,
  ApplyConfig,
} from "../../src/config/config-schema";

const baseGeneratorConfig: GeneratorConfig = {
  sourcePgHost: "config-source-host",
  sourcePgPort: 5432,
  sourcePgDatabase: "config_db",
  sourcePgUser: "config_user",
  sourcePgPassword: "CONFIG_PG_PASSWORD",
  sourcePgSsl: true,
  destPgHost: "config-dest-host",
  destPgPort: 5432,
  destPgDatabase: "config_db",
  destPgUser: "config_user",
  destPgPassword: "CONFIG_PG_PASSWORD_PROD",
  destPgSsl: false,
  schema: "public",
  tables: ["table_a", "table_b"],
  excludeTables: [],
  schemaDiffTables: ["schema_table_a", "schema_table_b"],
  schemaDiffExcludeTables: ["schema_table_z"],
  pgTriggersTables: ["pg_trigger_table_a", "pg_trigger_table_b"],
  pgTriggersExcludeTables: ["pg_trigger_table_z"],
  ignoreColumns: ["updated_at"],
  tablesWhereDataFilters: {
    directus_presets: '"user" IS NULL',
  },
  includeDeletes: true,
  skipMissingPk: false,
  output: "config-diff.json",
  schemaDiffOutput: "config-schema-diff.json",
  pgTriggersOutput: "config-triggers-diff.sql",
  pretty: true,
  generateSql: true,
};

const baseApplyConfig: ApplyConfig = {
  destPgHost: "config-dest-host",
  destPgPort: 5432,
  destPgDatabase: "config_db",
  destPgUser: "config_user",
  destPgPassword: "CONFIG_PG_PASSWORD_PROD",
  destPgSsl: false,
  input: "config-diff.json",
  dryRun: true,
  applyInserts: true,
  applyUpdates: true,
  applyDeletes: false,
  conflictMode: "abort",
  insertMode: "strict",
  transaction: true,
};

describe("resolveGeneratorOptions", () => {
  it("uses config values when no CLI args are provided", () => {
    const resolved = resolveGeneratorOptions(baseGeneratorConfig, {});
    expect(resolved.sourcePgHost).toBe("config-source-host");
    expect(resolved.tables).toEqual(["table_a", "table_b"]);
    expect(resolved.schemaDiffTables).toEqual([
      "schema_table_a",
      "schema_table_b",
    ]);
    expect(resolved.pgTriggersTables).toEqual([
      "pg_trigger_table_a",
      "pg_trigger_table_b",
    ]);
    expect(resolved.includeDeletes).toBe(true);
    expect(resolved.sourcePgSsl).toBe(true);
    expect(resolved.destPgSsl).toBe(false);
    expect(resolved.schemaDiffOutput).toBe("config-schema-diff.json");
    expect(resolved.pgTriggersOutput).toBe("config-triggers-diff.sql");
    expect(resolved.generateSql).toBe(true);
    expect(resolved.tablesWhereDataFilters).toEqual({
      directus_presets: '"user" IS NULL',
    });
  });

  it("CLI args override config values", () => {
    const resolved = resolveGeneratorOptions(baseGeneratorConfig, {
      sourcePgHost: "cli-source-host",
      output: "cli-diff.json",
      schemaDiffOutput: "cli-schema-diff.json",
      pgTriggersOutput: "cli-triggers-diff.sql",
    });
    expect(resolved.sourcePgHost).toBe("cli-source-host");
    expect(resolved.output).toBe("cli-diff.json");
    expect(resolved.schemaDiffOutput).toBe("cli-schema-diff.json");
    expect(resolved.pgTriggersOutput).toBe("cli-triggers-diff.sql");
    // Config values are preserved for non-overridden fields
    expect(resolved.sourcePgDatabase).toBe("config_db");
  });

  it("uses built-in defaults when config and CLI are both absent", () => {
    const resolved = resolveGeneratorOptions(undefined, {
      sourcePgHost: "h",
      sourcePgDatabase: "d",
      sourcePgUser: "u",
      sourcePgPassword: "MY_PASSWORD",
      sourcePgSsl: false,
      destPgHost: "h2",
      destPgDatabase: "d2",
      destPgUser: "u2",
      destPgPassword: "MY_DEST_PASSWORD",
      destPgSsl: true,
      tables: ["t"],
    });
    expect(resolved.schema).toBe("public");
    expect(resolved.output).toBe("frg-data-diff.json");
    expect(resolved.schemaDiffTables).toEqual(["t"]);
    expect(resolved.schemaDiffExcludeTables).toEqual([]);
    expect(resolved.pgTriggersTables).toEqual(["t"]);
    expect(resolved.pgTriggersExcludeTables).toEqual([]);
    expect(resolved.schemaDiffOutput).toBe("frg-schema-diff.json");
    expect(resolved.pgTriggersOutput).toBe("frg-triggers-diff.sql");
    expect(resolved.pretty).toBe(true);
    expect(resolved.includeDeletes).toBe(true);
    expect(resolved.skipMissingPk).toBe(true);
    expect(resolved.sourcePgSsl).toBe(false);
    expect(resolved.destPgSsl).toBe(true);
    expect(resolved.generateSql).toBeUndefined();
    expect(resolved.tablesWhereDataFilters).toEqual({});
  });

  it("excludes tables override from CLI", () => {
    const resolved = resolveGeneratorOptions(baseGeneratorConfig, {
      excludeTables: ["table_b"],
      schemaDiffExcludeTables: ["schema_table_b"],
      pgTriggersExcludeTables: ["pg_trigger_table_b"],
    });
    expect(resolved.excludeTables).toEqual(["table_b"]);
    expect(resolved.schemaDiffExcludeTables).toEqual(["schema_table_b"]);
    expect(resolved.pgTriggersExcludeTables).toEqual(["pg_trigger_table_b"]);
  });

  it("treats null optional lists as cleared rather than falling back", () => {
    const resolved = resolveGeneratorOptions(
      {
        ...baseGeneratorConfig,
        excludeTables: ["table_b"],
        schemaDiffExcludeTables: ["schema_table_b"],
        pgTriggersExcludeTables: ["pg_trigger_table_b"],
        ignoreColumns: ["updated_at"],
      },
      {
        excludeTables: null,
        schemaDiffExcludeTables: null,
        pgTriggersExcludeTables: null,
        ignoreColumns: null,
      },
    );

    expect(resolved.excludeTables).toEqual([]);
    expect(resolved.schemaDiffExcludeTables).toEqual([]);
    expect(resolved.pgTriggersExcludeTables).toEqual([]);
    expect(resolved.ignoreColumns).toEqual([]);
  });

  it("inherits main table filters when schema or PostgreSQL trigger filters are absent", () => {
    const resolved = resolveGeneratorOptions(
      {
        ...baseGeneratorConfig,
        tables: ["directus_*"],
        excludeTables: ["directus_sessions"],
        schemaDiffTables: undefined,
        schemaDiffExcludeTables: undefined,
        pgTriggersTables: undefined,
        pgTriggersExcludeTables: undefined,
      },
      {},
    );

    expect(resolved.tables).toEqual(["directus_*"]);
    expect(resolved.excludeTables).toEqual(["directus_sessions"]);
    expect(resolved.schemaDiffTables).toEqual(["directus_*"]);
    expect(resolved.schemaDiffExcludeTables).toEqual(["directus_sessions"]);
    expect(resolved.pgTriggersTables).toEqual(["directus_*"]);
    expect(resolved.pgTriggersExcludeTables).toEqual(["directus_sessions"]);
  });

  it("treats empty specialized table lists as unset and falls back to main tables", () => {
    const resolved = resolveGeneratorOptions(
      {
        ...baseGeneratorConfig,
        tables: ["directus_*"],
        schemaDiffTables: [],
        pgTriggersTables: [],
      },
      {},
    );

    expect(resolved.schemaDiffTables).toEqual(["directus_*"]);
    expect(resolved.pgTriggersTables).toEqual(["directus_*"]);
  });

  it("preserves env-backed list values during merge and expands them at runtime", () => {
    process.env.TEST_TABLES = "table_a, table_b";
    process.env.TEST_EXCLUDES = "table_z";
    process.env.TEST_SCHEMA_TABLES = "schema_a, schema_b";
    process.env.TEST_SCHEMA_EXCLUDES = "schema_z";
    process.env.TEST_PG_TRIGGERS_TABLES = "pg_trigger_a, pg_trigger_b";
    process.env.TEST_PG_TRIGGERS_EXCLUDES = "pg_trigger_z";
    process.env.TEST_IGNORES = "updated_at, created_at";

    const merged = resolveGeneratorOptions(
      {
        ...baseGeneratorConfig,
        tables: ["$TEST_TABLES"],
        excludeTables: [],
        schemaDiffTables: ["$TEST_SCHEMA_TABLES"],
        schemaDiffExcludeTables: ["$TEST_SCHEMA_EXCLUDES"],
        pgTriggersTables: ["$TEST_PG_TRIGGERS_TABLES"],
        pgTriggersExcludeTables: ["$TEST_PG_TRIGGERS_EXCLUDES"],
        ignoreColumns: [],
      },
      {
        excludeTables: ["$TEST_EXCLUDES"],
        ignoreColumns: ["$TEST_IGNORES"],
      },
    );

    expect(merged.tables).toEqual(["$TEST_TABLES"]);
    expect(merged.excludeTables).toEqual(["$TEST_EXCLUDES"]);
    expect(merged.schemaDiffTables).toEqual(["$TEST_SCHEMA_TABLES"]);
    expect(merged.schemaDiffExcludeTables).toEqual(["$TEST_SCHEMA_EXCLUDES"]);
    expect(merged.pgTriggersTables).toEqual(["$TEST_PG_TRIGGERS_TABLES"]);
    expect(merged.pgTriggersExcludeTables).toEqual([
      "$TEST_PG_TRIGGERS_EXCLUDES",
    ]);
    expect(merged.ignoreColumns).toEqual(["$TEST_IGNORES"]);

    const runtimeResolved = resolveRuntimeGeneratorOptions(merged);
    expect(runtimeResolved.tables).toEqual(["table_a", "table_b"]);
    expect(runtimeResolved.excludeTables).toEqual(["table_z"]);
    expect(runtimeResolved.schemaDiffTables).toEqual(["schema_a", "schema_b"]);
    expect(runtimeResolved.schemaDiffExcludeTables).toEqual(["schema_z"]);
    expect(runtimeResolved.pgTriggersTables).toEqual([
      "pg_trigger_a",
      "pg_trigger_b",
    ]);
    expect(runtimeResolved.pgTriggersExcludeTables).toEqual(["pg_trigger_z"]);
    expect(runtimeResolved.ignoreColumns).toEqual(["updated_at", "created_at"]);

    delete process.env.TEST_TABLES;
    delete process.env.TEST_EXCLUDES;
    delete process.env.TEST_SCHEMA_TABLES;
    delete process.env.TEST_SCHEMA_EXCLUDES;
    delete process.env.TEST_PG_TRIGGERS_TABLES;
    delete process.env.TEST_PG_TRIGGERS_EXCLUDES;
    delete process.env.TEST_IGNORES;
  });

  it("resolves env-backed scalar generator values at runtime", () => {
    process.env.RUNTIME_SCHEMA = "public";
    process.env.RUNTIME_OUTPUT = "runtime-diff.json";
    process.env.RUNTIME_SCHEMA_DIFF_OUTPUT = "runtime-schema-diff.json";
    process.env.RUNTIME_PG_TRIGGERS_OUTPUT = "runtime-triggers-diff.sql";
    process.env.RUNTIME_INCLUDE_DELETES = "yes";
    process.env.RUNTIME_SKIP_MISSING_PK = "no";
    process.env.RUNTIME_PRETTY = "true";
    process.env.RUNTIME_SOURCE_SSL = "yes";
    process.env.RUNTIME_DEST_SSL = "no";
    process.env.RUNTIME_GENERATE_SQL = "yes";

    const runtimeResolved = resolveRuntimeGeneratorOptions(
      resolveGeneratorOptions(undefined, {
        sourcePgHost: "h",
        sourcePgDatabase: "d",
        sourcePgUser: "u",
        sourcePgPassword: "p",
        sourcePgSsl: "$RUNTIME_SOURCE_SSL",
        destPgHost: "h2",
        destPgDatabase: "d2",
        destPgUser: "u2",
        destPgPassword: "p2",
        destPgSsl: "$RUNTIME_DEST_SSL",
        schema: "$RUNTIME_SCHEMA",
        tables: ["table_a"],
        schemaDiffTables: ["schema_a"],
        includeDeletes: "$RUNTIME_INCLUDE_DELETES",
        skipMissingPk: "$RUNTIME_SKIP_MISSING_PK",
        output: "$RUNTIME_OUTPUT",
        schemaDiffOutput: "$RUNTIME_SCHEMA_DIFF_OUTPUT",
        pgTriggersOutput: "$RUNTIME_PG_TRIGGERS_OUTPUT",
        pretty: "$RUNTIME_PRETTY",
        generateSql: "$RUNTIME_GENERATE_SQL",
      }),
    );

    expect(runtimeResolved.schema).toBe("public");
    expect(runtimeResolved.output).toBe("runtime-diff.json");
    expect(runtimeResolved.schemaDiffTables).toEqual(["schema_a"]);
    expect(runtimeResolved.schemaDiffOutput).toBe("runtime-schema-diff.json");
    expect(runtimeResolved.pgTriggersOutput).toBe("runtime-triggers-diff.sql");
    expect(runtimeResolved.includeDeletes).toBe(true);
    expect(runtimeResolved.skipMissingPk).toBe(false);
    expect(runtimeResolved.pretty).toBe(true);
    expect(runtimeResolved.sourcePgSsl).toBe(true);
    expect(runtimeResolved.destPgSsl).toBe(false);
    expect(runtimeResolved.generateSql).toBe(true);

    delete process.env.RUNTIME_SCHEMA;
    delete process.env.RUNTIME_OUTPUT;
    delete process.env.RUNTIME_SCHEMA_DIFF_OUTPUT;
    delete process.env.RUNTIME_PG_TRIGGERS_OUTPUT;
    delete process.env.RUNTIME_INCLUDE_DELETES;
    delete process.env.RUNTIME_SKIP_MISSING_PK;
    delete process.env.RUNTIME_PRETTY;
    delete process.env.RUNTIME_SOURCE_SSL;
    delete process.env.RUNTIME_DEST_SSL;
    delete process.env.RUNTIME_GENERATE_SQL;
  });
});

describe("resolveApplyOptions", () => {
  it("uses config values when no CLI args provided", () => {
    const resolved = resolveApplyOptions(baseApplyConfig, {});
    expect(resolved.destPgHost).toBe("config-dest-host");
    expect(resolved.dryRun).toBe(true);
    expect(resolved.applyDeletes).toBe(false);
  });

  it("CLI args override config values", () => {
    const resolved = resolveApplyOptions(baseApplyConfig, {
      destPgHost: "cli-dest-host",
      dryRun: false,
    });
    expect(resolved.destPgHost).toBe("cli-dest-host");
    expect(resolved.dryRun).toBe(false);
    expect(resolved.destPgDatabase).toBe("config_db"); // unchanged
  });

  it("applyDeletes defaults to false even without config", () => {
    const resolved = resolveApplyOptions(undefined, {
      destPgHost: "h",
      destPgDatabase: "d",
      destPgUser: "u",
      destPgPassword: "MY_PASS",
      destPgSsl: true,
    });
    expect(resolved.applyDeletes).toBe(false);
    expect(resolved.destPgSsl).toBe(true);
  });

  it("dryRun defaults to true without config", () => {
    const resolved = resolveApplyOptions(undefined, {
      destPgHost: "h",
      destPgDatabase: "d",
      destPgUser: "u",
      destPgPassword: "MY_PASS",
    });
    expect(resolved.dryRun).toBe(true);
  });

  it("conflictMode defaults to abort", () => {
    const resolved = resolveApplyOptions(undefined, {
      destPgHost: "h",
      destPgDatabase: "d",
      destPgUser: "u",
      destPgPassword: "MY_PASS",
    });
    expect(resolved.conflictMode).toBe("abort");
  });

  it("transaction defaults to true", () => {
    const resolved = resolveApplyOptions(undefined, {
      destPgHost: "h",
      destPgDatabase: "d",
      destPgUser: "u",
      destPgPassword: "MY_PASS",
    });
    expect(resolved.transaction).toBe(true);
  });

  it("resolves env-backed apply values at runtime", () => {
    process.env.RUNTIME_INPUT = "runtime-diff.json";
    process.env.RUNTIME_DRY_RUN = "false";
    process.env.RUNTIME_APPLY_INSERTS = "true";
    process.env.RUNTIME_APPLY_UPDATES = "no";
    process.env.RUNTIME_APPLY_DELETES = "yes";
    process.env.RUNTIME_CONFLICT_MODE = "skip";
    process.env.RUNTIME_INSERT_MODE = "upsert";
    process.env.RUNTIME_TRANSACTION = "1";
    process.env.RUNTIME_DEST_SSL = "true";

    const runtimeResolved = resolveRuntimeApplyOptions(
      resolveApplyOptions(undefined, {
        destPgHost: "h",
        destPgDatabase: "d",
        destPgUser: "u",
        destPgPassword: "p",
        destPgSsl: "$RUNTIME_DEST_SSL",
        input: "$RUNTIME_INPUT",
        dryRun: "$RUNTIME_DRY_RUN",
        applyInserts: "$RUNTIME_APPLY_INSERTS",
        applyUpdates: "$RUNTIME_APPLY_UPDATES",
        applyDeletes: "$RUNTIME_APPLY_DELETES",
        conflictMode: "$RUNTIME_CONFLICT_MODE",
        insertMode: "$RUNTIME_INSERT_MODE",
        transaction: "$RUNTIME_TRANSACTION",
      }),
    );

    expect(runtimeResolved.input).toBe("runtime-diff.json");
    expect(runtimeResolved.dryRun).toBe(false);
    expect(runtimeResolved.applyInserts).toBe(true);
    expect(runtimeResolved.applyUpdates).toBe(false);
    expect(runtimeResolved.applyDeletes).toBe(true);
    expect(runtimeResolved.conflictMode).toBe("skip");
    expect(runtimeResolved.insertMode).toBe("upsert");
    expect(runtimeResolved.transaction).toBe(true);
    expect(runtimeResolved.destPgSsl).toBe(true);

    delete process.env.RUNTIME_INPUT;
    delete process.env.RUNTIME_DRY_RUN;
    delete process.env.RUNTIME_APPLY_INSERTS;
    delete process.env.RUNTIME_APPLY_UPDATES;
    delete process.env.RUNTIME_APPLY_DELETES;
    delete process.env.RUNTIME_CONFLICT_MODE;
    delete process.env.RUNTIME_INSERT_MODE;
    delete process.env.RUNTIME_TRANSACTION;
    delete process.env.RUNTIME_DEST_SSL;
  });
});
