import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import { promptForGeneratorOptions } from "../../src/shared/generator-wizard";
import type { ResolvedGeneratorOptions } from "../../src/config/resolve-options";

const defaults: ResolvedGeneratorOptions = {
  sourcePgHost: "",
  sourcePgPort: 5432,
  sourcePgDatabase: "",
  sourcePgUser: "",
  sourcePgPassword: "",
  sourcePgSsl: false,
  destPgHost: "",
  destPgPort: 5432,
  destPgDatabase: "",
  destPgUser: "",
  destPgPassword: "",
  destPgSsl: false,
  schema: "public",
  tables: [],
  excludeTables: [],
  schemaDiffTables: [],
  schemaDiffExcludeTables: [],
  pgTriggersTables: [],
  pgTriggersExcludeTables: [],
  ignoreColumns: [],
  includeDeletes: true,
  skipMissingPk: true,
  output: "frg-data-diff.json",
  schemaDiffOutput: "frg-schema-diff.json",
  pgTriggersOutput: "frg-triggers-diff.sql",
  pretty: true,
  generateSql: undefined,
  verbose: false,
};

describe("promptForGeneratorOptions", () => {
  it("collects source and destination values variable by variable", async () => {
    const prompt = promptWithAnswers([
      "source.local",
      "5433",
      "source_user",
      "$PG_PASSWORD_SOURCE",
      "yes",
      "source_db",
      "dest.local",
      "5434",
      "dest_user",
      "$PG_PASSWORD_DEST",
      "no",
      "dest_db",
      "directus",
      "directus_collections, directus_fields",
      "",
      "updated_at",
      "yes",
      "no",
      "diff.json",
      "no",
      "directus_schema_*",
      "directus_revisions",
      "schema-diff.json",
      "directus_flows",
      "directus_operations",
      "triggers-diff.sql",
      "yes",
      "yes",
    ]);

    const options = await withSilencedConsole(() =>
      promptForGeneratorOptions(defaults, prompt, { env: existingEnv() }),
    );

    expect(options).toMatchObject({
      sourcePgHost: "source.local",
      sourcePgPort: 5433,
      sourcePgUser: "source_user",
      sourcePgPassword: "$PG_PASSWORD_SOURCE",
      sourcePgSsl: true,
      sourcePgDatabase: "source_db",
      destPgHost: "dest.local",
      destPgPort: 5434,
      destPgUser: "dest_user",
      destPgPassword: "$PG_PASSWORD_DEST",
      destPgSsl: false,
      destPgDatabase: "dest_db",
      schema: "directus",
      tables: ["directus_collections", "directus_fields"],
      excludeTables: [],
      schemaDiffTables: ["directus_schema_*"],
      schemaDiffExcludeTables: ["directus_revisions"],
      pgTriggersTables: ["directus_flows"],
      pgTriggersExcludeTables: ["directus_operations"],
      ignoreColumns: ["updated_at"],
      includeDeletes: true,
      skipMissingPk: false,
      output: "diff.json",
      schemaDiffOutput: "schema-diff.json",
      pgTriggersOutput: "triggers-diff.sql",
      pretty: true,
      generateSql: false,
      generatePgTriggers: true,
    });
  });

  it("uses defaults when the user presses enter", async () => {
    const prompt = promptWithAnswers(Array(28).fill(""));
    const configuredDefaults: ResolvedGeneratorOptions = {
      ...defaults,
      sourcePgHost: "$SOURCE_HOST",
      sourcePgPort: "$SOURCE_PORT",
      sourcePgUser: "source_user",
      sourcePgPassword: "$PG_PASSWORD_SOURCE",
      sourcePgDatabase: "source_db",
      destPgHost: "config-dest.local",
      destPgUser: "dest_user",
      destPgPassword: "existing-literal-password",
      destPgDatabase: "dest_db",
      tables: ["table_a"],
      excludeTables: ["table_z"],
      schemaDiffTables: ["schema_table_a"],
      schemaDiffExcludeTables: ["schema_table_z"],
      pgTriggersTables: ["pg_trigger_table_a"],
      pgTriggersExcludeTables: ["pg_trigger_table_z"],
      pgTriggersOutput: "pg-triggers-diff.sql",
      ignoreColumns: ["updated_at"],
      schemaDiffOutput: "schema-diff.json",
    };

    const options = await withSilencedConsole(() =>
      promptForGeneratorOptions(configuredDefaults, prompt, {
        env: {
          ...existingEnv(),
          SOURCE_PORT: "5432",
        },
      }),
    );

    expect(options.sourcePgHost).toBe("$SOURCE_HOST");
    expect(options.sourcePgPort).toBe("$SOURCE_PORT");
    expect(options.destPgPassword).toBe("existing-literal-password");
    expect(options.tables).toEqual(["table_a"]);
    expect(options.excludeTables).toEqual(["table_z"]);
    expect(options.schemaDiffTables).toEqual(["schema_table_a"]);
    expect(options.schemaDiffExcludeTables).toEqual(["schema_table_z"]);
    expect(options.pgTriggersTables).toEqual(["pg_trigger_table_a"]);
    expect(options.pgTriggersExcludeTables).toEqual(["pg_trigger_table_z"]);
    expect(options.pgTriggersOutput).toBe("pg-triggers-diff.sql");
    expect(options.ignoreColumns).toEqual(["updated_at"]);
    expect(options.schemaDiffOutput).toBe("schema-diff.json");
    expect(options.generateSql).toBe(true);
    expect(options.generatePgTriggers).toBe(true);
  });

  it('clears optional lists when the user types "none"', async () => {
    const prompt = promptWithAnswers([
      "", // source host
      "", // source port
      "", // source user
      "", // source password
      "", // source ssl
      "", // source database
      "", // destination host
      "", // destination port
      "", // destination user
      "", // destination password
      "", // destination ssl
      "", // destination database
      "", // schema
      "", // data tables
      "none",
      "none",
      "", // include deletes
      "", // skip missing pk
      "", // output
      "", // generate sql
      "", // schema tables
      "none",
      "", // schema output
      "", // pg trigger tables
      "none",
      "", // pg trigger output
      "", // generate pg triggers
      "", // pretty
    ]);
    const configuredDefaults: ResolvedGeneratorOptions = {
      ...defaults,
      sourcePgHost: "source.local",
      sourcePgPort: 5432,
      sourcePgUser: "source_user",
      sourcePgPassword: "$PG_PASSWORD_SOURCE",
      sourcePgSsl: true,
      sourcePgDatabase: "source_db",
      destPgHost: "dest.local",
      destPgPort: 5432,
      destPgUser: "dest_user",
      destPgPassword: "$PG_PASSWORD_DEST",
      destPgSsl: true,
      destPgDatabase: "dest_db",
      tables: ["table_a"],
      excludeTables: ["table_z"],
      schemaDiffTables: ["schema_table_a"],
      schemaDiffExcludeTables: ["schema_table_z"],
      pgTriggersTables: ["pg_trigger_table_a"],
      pgTriggersExcludeTables: ["pg_trigger_table_z"],
      ignoreColumns: ["updated_at"],
      generateSql: true,
      schemaDiffOutput: "schema-diff.json",
    };

    const options = await withSilencedConsole(() =>
      promptForGeneratorOptions(configuredDefaults, prompt, {
        env: existingEnv(),
      }),
    );

    expect(options.excludeTables).toEqual([]);
    expect(options.schemaDiffExcludeTables).toEqual([]);
    expect(options.pgTriggersExcludeTables).toEqual([]);
    expect(options.ignoreColumns).toEqual([]);
  });

  it("shows when an env-backed password default is already loaded", async () => {
    const messages: string[] = [];
    const prompt = vi.fn(async (message: string) => {
      messages.push(message);
      return "";
    });
    const configuredDefaults: ResolvedGeneratorOptions = {
      ...defaults,
      sourcePgHost: "source.local",
      sourcePgPort: 5432,
      sourcePgUser: "source_user",
      sourcePgPassword: "$PG_PASSWORD_SOURCE",
      sourcePgSsl: true,
      sourcePgDatabase: "source_db",
      destPgHost: "dest.local",
      destPgPort: 5432,
      destPgUser: "dest_user",
      destPgPassword: "$PG_PASSWORD_DEST",
      destPgSsl: true,
      destPgDatabase: "dest_db",
      tables: ["table_a"],
      schemaDiffTables: ["schema_table_a"],
      pgTriggersTables: ["pg_trigger_table_a"],
      generateSql: true,
      schemaDiffOutput: "schema-diff.json",
    };

    await withSilencedConsole(() =>
      promptForGeneratorOptions(configuredDefaults, prompt, {
        env: existingEnv(),
      }),
    );

    expect(messages).toContain(
      "Source password ($ENV_VAR or plain text) [$PG_PASSWORD_SOURCE loaded]: ",
    );
    expect(messages).toContain(
      "Destination password ($ENV_VAR or plain text) [$PG_PASSWORD_DEST loaded]: ",
    );
  });

  it("reprompts invalid ports, invalid env refs, required values, lists, and booleans", async () => {
    const prompt = promptWithAnswers([
      "",
      "source.local",
      "abc",
      "$bad-port",
      "5433",
      "source_user",
      "$bad password",
      "$PG_PASSWORD_SOURCE",
      "yes",
      "source_db",
      "dest.local",
      "70000",
      "5434",
      "dest_user",
      "$bad-pass",
      "plain-password",
      "maybe",
      "no",
      "dest_db",
      "public",
      "",
      "table_a",
      "",
      "",
      "maybe",
      "no",
      "no",
      "diff.json",
      "yes",
      "",
      "schema_table_a",
      "",
      "schema-diff.json",
      "pg_trigger_table_a",
      "",
      "triggers-diff.sql",
      "no",
      "yes",
    ]);

    const options = await withSilencedConsole(() =>
      promptForGeneratorOptions(defaults, prompt, { env: existingEnv() }),
    );

    expect(options.sourcePgHost).toBe("source.local");
    expect(options.sourcePgPort).toBe(5433);
    expect(options.sourcePgPassword).toBe("$PG_PASSWORD_SOURCE");
    expect(options.destPgPort).toBe(5434);
    expect(options.destPgPassword).toBe("plain-password");
    expect(options.destPgSsl).toBe(false);
    expect(options.tables).toEqual(["table_a"]);
    expect(options.schemaDiffTables).toEqual(["schema_table_a"]);
    expect(options.pgTriggersTables).toEqual(["pg_trigger_table_a"]);
    expect(options.includeDeletes).toBe(false);
    expect(options.skipMissingPk).toBe(false);
    expect(options.schemaDiffOutput).toBe("schema-diff.json");
    expect(options.generateSql).toBe(true);
    expect(options.generatePgTriggers).toBe(false);
  });

  it("asks for missing $ENV_VAR values, writes .envrc, and loads them for the run", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "frg-envrc-test-"));
    const envrcPath = path.join(tempDir, ".envrc");
    fs.writeFileSync(
      envrcPath,
      "export SOURCE_HOST='old-host'\nexport OTHER='x'\n",
      "utf-8",
    );
    const env: NodeJS.ProcessEnv = {
      PG_PASSWORD_DEST: "already-loaded",
    };
    const prompt = promptWithAnswers([
      "$SOURCE_HOST",
      "source.local",
      "$SOURCE_PORT",
      "5433",
      "$SOURCE_USER",
      "source_user",
      "$PG_PASSWORD_SOURCE",
      "s'ource pass",
      "yes",
      "$SOURCE_DB",
      "source_db",
      "dest.local",
      "5434",
      "dest_user",
      "$PG_PASSWORD_DEST",
      "no",
      "dest_db",
      "public",
      "table_a",
      "",
      "",
      "",
      "no",
      "no",
      "diff.json",
      "no",
      "schema_table_a",
      "",
      "schema-diff.json",
      "pg_trigger_table_a",
      "",
      "",
      "no",
      "yes",
    ]);

    const options = await withSilencedConsole(() =>
      promptForGeneratorOptions(defaults, prompt, {
        env,
        envrcPath,
      }),
    );

    expect(options.sourcePgHost).toBe("$SOURCE_HOST");
    expect(options.sourcePgPort).toBe("$SOURCE_PORT");
    expect(options.sourcePgUser).toBe("$SOURCE_USER");
    expect(options.sourcePgPassword).toBe("$PG_PASSWORD_SOURCE");
    expect(options.sourcePgSsl).toBe(true);
    expect(options.sourcePgDatabase).toBe("$SOURCE_DB");
    expect(options.schemaDiffTables).toEqual(["schema_table_a"]);
    expect(options.schemaDiffOutput).toBe("schema-diff.json");
    expect(options.generateSql).toBe(false);
    expect(env.SOURCE_HOST).toBe("source.local");
    expect(env.SOURCE_PORT).toBe("5433");
    expect(env.SOURCE_USER).toBe("source_user");
    expect(env.PG_PASSWORD_SOURCE).toBe("s'ource pass");
    expect(env.SOURCE_DB).toBe("source_db");
    expect(env.PG_PASSWORD_DEST).toBe("already-loaded");
    expect(fs.readFileSync(envrcPath, "utf-8")).toBe(
      "export SOURCE_HOST='source.local'\n" +
        "export OTHER='x'\n" +
        "export SOURCE_PORT='5433'\n" +
        "export SOURCE_USER='source_user'\n" +
        "export PG_PASSWORD_SOURCE='s'\\''ource pass'\n" +
        "export SOURCE_DB='source_db'\n",
    );
  });

  it("accepts lowercase and camelCase env references in wizard input", async () => {
    const prompt = promptWithAnswers([
      "$sourceHost",
      "source.local",
      "$sourcePort",
      "5433",
      "$sourceUser",
      "source_user",
      "$pgPasswordSource",
      "source-pass",
      "yes",
      "$sourceDb",
      "source_db",
      "dest.local",
      "5434",
      "dest_user",
      "$destPassword",
      "dest-pass",
      "no",
      "dest_db",
      "public",
      "table_a",
      "",
      "",
      "",
      "yes",
      "yes",
      "diff.json",
      "yes",
      "schema_table_a",
      "",
      "schema-diff.json",
      "pg_trigger_table_a",
      "",
      "",
      "no",
      "yes",
    ]);

    const env: NodeJS.ProcessEnv = {};
    const options = await withSilencedConsole(() =>
      promptForGeneratorOptions(defaults, prompt, { env }),
    );

    expect(options.sourcePgHost).toBe("$sourceHost");
    expect(options.sourcePgPort).toBe("$sourcePort");
    expect(options.sourcePgUser).toBe("$sourceUser");
    expect(options.sourcePgPassword).toBe("$pgPasswordSource");
    expect(options.sourcePgDatabase).toBe("$sourceDb");
    expect(options.destPgPassword).toBe("$destPassword");
    expect(options.schemaDiffTables).toEqual(["schema_table_a"]);
    expect(options.schemaDiffOutput).toBe("schema-diff.json");
    expect(options.generateSql).toBe(true);
  });

  it("accepts env-backed table filters and stores missing values in .envrc", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "frg-envrc-list-test-"),
    );
    const envrcPath = path.join(tempDir, ".envrc");
    const env: NodeJS.ProcessEnv = {
      PG_PASSWORD_SOURCE: "source-password",
      PG_PASSWORD_DEST: "dest-password",
    };
    const prompt = promptWithAnswers([
      "source.local",
      "5432",
      "source_user",
      "$PG_PASSWORD_SOURCE",
      "yes",
      "source_db",
      "dest.local",
      "5432",
      "dest_user",
      "$PG_PASSWORD_DEST",
      "no",
      "dest_db",
      "public",
      "$diffTables",
      "directus_*, custom_table",
      "$excludedTables",
      "directus_activity",
      "$ignoredColumns",
      "updated_at, created_at",
      "yes",
      "yes",
      "diff.json",
      "$generateSql",
      "no",
      "$schemaDiffTables",
      "directus_fields, directus_relations",
      "$schemaExcludedTables",
      "directus_revisions",
      "schema-diff.json",
      "$pgTriggersTables",
      "directus_flows, directus_operations",
      "$pgTriggersExcludedTables",
      "directus_sessions",
      "$pgTriggersOutput",
      "triggers-diff.sql",
      "yes",
      "yes",
    ]);

    const options = await withSilencedConsole(() =>
      promptForGeneratorOptions(defaults, prompt, { env, envrcPath }),
    );

    expect(options.tables).toEqual(["$diffTables"]);
    expect(options.excludeTables).toEqual(["$excludedTables"]);
    expect(options.schemaDiffTables).toEqual(["$schemaDiffTables"]);
    expect(options.schemaDiffExcludeTables).toEqual(["$schemaExcludedTables"]);
    expect(options.pgTriggersTables).toEqual(["$pgTriggersTables"]);
    expect(options.pgTriggersExcludeTables).toEqual([
      "$pgTriggersExcludedTables",
    ]);
    expect(options.ignoreColumns).toEqual(["$ignoredColumns"]);
    expect(options.schemaDiffOutput).toBe("schema-diff.json");
    expect(options.pgTriggersOutput).toBe("$pgTriggersOutput");
    expect(options.generateSql).toBe("$generateSql");
    expect(env.diffTables).toBe("directus_*, custom_table");
    expect(env.excludedTables).toBe("directus_activity");
    expect(env.schemaDiffTables).toBe("directus_fields, directus_relations");
    expect(env.schemaExcludedTables).toBe("directus_revisions");
    expect(env.pgTriggersTables).toBe("directus_flows, directus_operations");
    expect(env.pgTriggersExcludedTables).toBe("directus_sessions");
    expect(env.pgTriggersOutput).toBe("triggers-diff.sql");
    expect(env.ignoredColumns).toBe("updated_at, created_at");
    expect(env.generateSql).toBe("no");
    expect(fs.readFileSync(envrcPath, "utf-8")).toContain(
      "export diffTables='directus_*, custom_table'",
    );
    expect(fs.readFileSync(envrcPath, "utf-8")).toContain(
      "export excludedTables='directus_activity'",
    );
    expect(fs.readFileSync(envrcPath, "utf-8")).toContain(
      "export schemaDiffTables='directus_fields, directus_relations'",
    );
    expect(fs.readFileSync(envrcPath, "utf-8")).toContain(
      "export schemaExcludedTables='directus_revisions'",
    );
    expect(fs.readFileSync(envrcPath, "utf-8")).toContain(
      "export pgTriggersTables='directus_flows, directus_operations'",
    );
    expect(fs.readFileSync(envrcPath, "utf-8")).toContain(
      "export pgTriggersExcludedTables='directus_sessions'",
    );
    expect(fs.readFileSync(envrcPath, "utf-8")).toContain(
      "export pgTriggersOutput='triggers-diff.sql'",
    );
    expect(fs.readFileSync(envrcPath, "utf-8")).toContain(
      "export ignoredColumns='updated_at, created_at'",
    );
    expect(fs.readFileSync(envrcPath, "utf-8")).toContain(
      "export generateSql='no'",
    );
  });

  it("notifies the caller when .envrc was written during the wizard", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "frg-envrc-callback-test-"),
    );
    const envrcPath = path.join(tempDir, ".envrc");
    const env: NodeJS.ProcessEnv = {
      PG_PASSWORD_DEST: "dest-password",
    };
    const onEnvrcWrite = vi.fn();
    const prompt = promptWithAnswers([
      "source.local",
      "$sourcePort",
      "5432",
      "source_user",
      "$PG_PASSWORD_SOURCE",
      "source-password",
      "yes",
      "source_db",
      "dest.local",
      "5432",
      "dest_user",
      "$PG_PASSWORD_DEST",
      "no",
      "dest_db",
      "public",
      "table_a",
      "",
      "",
      "yes",
      "yes",
      "diff.json",
      "yes",
      "schema_table_a",
      "",
      "schema-diff.json",
      "pg_trigger_table_a",
      "",
      "triggers-diff.sql",
      "yes",
      "yes",
    ]);

    await withSilencedConsole(() =>
      promptForGeneratorOptions(defaults, prompt, {
        env,
        envrcPath,
        onEnvrcWrite,
      }),
    );

    expect(onEnvrcWrite).toHaveBeenCalled();
  });
});

function promptWithAnswers(answers: string[]) {
  let index = 0;
  return vi.fn(async () => {
    if (index >= answers.length)
      throw new Error("No test answer left for prompt.");
    return answers[index++];
  });
}

function existingEnv(): NodeJS.ProcessEnv {
  return {
    PG_PASSWORD_SOURCE: "source-password",
    PG_PASSWORD_DEST: "dest-password",
    SOURCE_HOST: "config-source.local",
  };
}

async function withSilencedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    return await fn();
  } finally {
    log.mockRestore();
  }
}
