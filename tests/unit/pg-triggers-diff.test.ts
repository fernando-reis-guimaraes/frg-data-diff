import { describe, it, expect } from "vitest";
import {
  resolveGeneratorOptions,
  resolveRuntimeGeneratorOptions,
} from "../../src/config/resolve-options";
import { generatorConfigSchema } from "../../src/config/config-schema";
import { buildConfigFile } from "../../src/config/write-config";
import type {
  ResolvedGeneratorOptions,
  ResolvedApplyOptions,
} from "../../src/config/resolve-options";

// ---------------------------------------------------------------------------
//  Shared fixtures
// ---------------------------------------------------------------------------

const baseGeneratorConfig = {
  sourcePgHost: "source-host",
  sourcePgPort: 5432,
  sourcePgDatabase: "source_db",
  sourcePgUser: "source_user",
  sourcePgPassword: "source_pass",
  sourcePgSsl: false,
  destPgHost: "dest-host",
  destPgPort: 5432,
  destPgDatabase: "dest_db",
  destPgUser: "dest_user",
  destPgPassword: "dest_pass",
  destPgSsl: false,
  schema: "public",
  tables: ["table_a"],
  excludeTables: [] as string[],
  schemaDiffTables: ["table_a"],
  schemaDiffExcludeTables: [] as string[],
  pgTriggersTables: ["table_a"],
  pgTriggersExcludeTables: [] as string[],
  pgViews: [] as string[],
  pgViewsExclude: [] as string[],
  ignoreColumns: [] as string[],
  includeDeletes: true,
  skipMissingPk: true,
  output: "frg-data-diff.json",
  schemaDiffOutput: "frg-schema-diff.json",
  pgTriggersOutput: "frg-triggers-diff.sql",
  pgViewsOutput: "frg-views-diff.sql",
  pretty: true,
  generateSql: true,
};

const baseApplyOpts: ResolvedApplyOptions = {
  destPgHost: "dest-host",
  destPgPort: 5432,
  destPgDatabase: "dest_db",
  destPgUser: "dest_user",
  destPgPassword: "dest_pass",
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

// ---------------------------------------------------------------------------
//  Config schema tests for generatePgTriggers
// ---------------------------------------------------------------------------

describe("generatorConfigSchema – generatePgTriggers", () => {
  it("allows generatePgTriggers to be omitted", () => {
    const { generatePgTriggers: _, ...rest } = baseGeneratorConfig;
    const result = generatorConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.generatePgTriggers).toBeUndefined();
    }
  });

  it("accepts generatePgTriggers as true", () => {
    const result = generatorConfigSchema.safeParse({
      ...baseGeneratorConfig,
      generatePgTriggers: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.generatePgTriggers).toBe(true);
    }
  });

  it("accepts generatePgTriggers as false", () => {
    const result = generatorConfigSchema.safeParse({
      ...baseGeneratorConfig,
      generatePgTriggers: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.generatePgTriggers).toBe(false);
    }
  });

  it("accepts generatePgTriggers as an env-backed string", () => {
    const result = generatorConfigSchema.safeParse({
      ...baseGeneratorConfig,
      generatePgTriggers: "$GENERATE_PG_TRIGGERS",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
//  resolveGeneratorOptions tests for generatePgTriggers
// ---------------------------------------------------------------------------

describe("resolveGeneratorOptions – generatePgTriggers", () => {
  it("uses config value when no CLI arg is provided", () => {
    const resolved = resolveGeneratorOptions(
      { ...baseGeneratorConfig, generatePgTriggers: true },
      {},
    );
    expect(resolved.generatePgTriggers).toBe(true);
  });

  it("CLI arg overrides config value", () => {
    const resolved = resolveGeneratorOptions(
      { ...baseGeneratorConfig, generatePgTriggers: true },
      { generatePgTriggers: false },
    );
    expect(resolved.generatePgTriggers).toBe(false);
  });

  it("is undefined when neither config nor CLI provides it", () => {
    const resolved = resolveGeneratorOptions({ ...baseGeneratorConfig }, {});
    expect(resolved.generatePgTriggers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
//  resolveRuntimeGeneratorOptions tests for generatePgTriggers
// ---------------------------------------------------------------------------

describe("resolveRuntimeGeneratorOptions – generatePgTriggers", () => {
  it("resolves a boolean value", () => {
    const resolved = resolveGeneratorOptions(
      { ...baseGeneratorConfig, generatePgTriggers: true },
      {},
    );
    const runtime = resolveRuntimeGeneratorOptions(resolved);
    expect(runtime.generatePgTriggers).toBe(true);
  });

  it("resolves an env-backed value", () => {
    process.env.TEST_PG_TRIGGERS = "yes";
    try {
      const resolved = resolveGeneratorOptions(
        { ...baseGeneratorConfig, generatePgTriggers: "$TEST_PG_TRIGGERS" },
        {},
      );
      const runtime = resolveRuntimeGeneratorOptions(resolved);
      expect(runtime.generatePgTriggers).toBe(true);
    } finally {
      delete process.env.TEST_PG_TRIGGERS;
    }
  });

  it("is undefined when not set", () => {
    const resolved = resolveGeneratorOptions({ ...baseGeneratorConfig }, {});
    const runtime = resolveRuntimeGeneratorOptions(resolved);
    expect(runtime.generatePgTriggers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
//  buildConfigFile tests for generatePgTriggers
// ---------------------------------------------------------------------------

describe("buildConfigFile – generatePgTriggers", () => {
  it("includes generatePgTriggers when set to true", () => {
    const generatorOpts: ResolvedGeneratorOptions = {
      ...baseGeneratorConfig,
      generatePgTriggers: true,
      verbose: false,
    };
    const config = buildConfigFile(generatorOpts, baseApplyOpts) as {
      generator: Record<string, unknown>;
    };
    expect(config.generator["generatePgTriggers"]).toBe(true);
  });

  it("includes generatePgTriggers when set to false", () => {
    const generatorOpts: ResolvedGeneratorOptions = {
      ...baseGeneratorConfig,
      generatePgTriggers: false,
      verbose: false,
    };
    const config = buildConfigFile(generatorOpts, baseApplyOpts) as {
      generator: Record<string, unknown>;
    };
    expect(config.generator["generatePgTriggers"]).toBe(false);
  });

  it("includes generatePgTriggers as undefined when omitted", () => {
    const generatorOpts: ResolvedGeneratorOptions = {
      ...baseGeneratorConfig,
      verbose: false,
    };
    const config = buildConfigFile(generatorOpts, baseApplyOpts) as {
      generator: Record<string, unknown>;
    };
    expect(config.generator["generatePgTriggers"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
//  SQL rewriting tests (CREATE → CREATE OR REPLACE)
// ---------------------------------------------------------------------------

describe("pg-triggers SQL rewriting", () => {
  // These tests exercise the rewriting logic inline rather than going through
  // the full async diff pipeline, which needs live DB connections.

  function rewriteFunction(def: string): string {
    let d = def.trim();
    if (d.toUpperCase().startsWith("CREATE FUNCTION")) {
      d = "CREATE OR REPLACE FUNCTION" + d.substring("CREATE FUNCTION".length);
    }
    if (!d.endsWith(";")) d += ";";
    return d;
  }

  function rewriteTrigger(def: string): string {
    let d = def.trim();
    if (d.toUpperCase().startsWith("CREATE TRIGGER")) {
      d = "CREATE OR REPLACE TRIGGER" + d.substring("CREATE TRIGGER".length);
    }
    if (!d.endsWith(";")) d += ";";
    return d;
  }

  it("rewrites CREATE FUNCTION to CREATE OR REPLACE FUNCTION", () => {
    const input =
      "CREATE FUNCTION public.my_func() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$";
    const result = rewriteFunction(input);
    expect(result).toMatch(/^CREATE OR REPLACE FUNCTION/);
    expect(result).toContain("public.my_func()");
    expect(result.endsWith(";")).toBe(true);
  });

  it("rewrites CREATE TRIGGER to CREATE OR REPLACE TRIGGER", () => {
    const input =
      "CREATE TRIGGER my_trigger AFTER INSERT ON public.my_table FOR EACH ROW EXECUTE FUNCTION public.my_func()";
    const result = rewriteTrigger(input);
    expect(result).toMatch(/^CREATE OR REPLACE TRIGGER/);
    expect(result).toContain("my_trigger");
    expect(result.endsWith(";")).toBe(true);
  });

  it("does not double-rewrite CREATE OR REPLACE FUNCTION", () => {
    const input =
      "CREATE OR REPLACE FUNCTION public.my_func() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$";
    const result = rewriteFunction(input);
    expect(result).not.toMatch(/CREATE OR REPLACE OR REPLACE/);
    expect(result).toMatch(/^CREATE OR REPLACE FUNCTION/);
  });

  it("does not double-rewrite CREATE OR REPLACE TRIGGER", () => {
    const input =
      "CREATE OR REPLACE TRIGGER my_trigger AFTER INSERT ON public.my_table FOR EACH ROW EXECUTE FUNCTION public.my_func()";
    const result = rewriteTrigger(input);
    expect(result).not.toMatch(/CREATE OR REPLACE OR REPLACE/);
    expect(result).toMatch(/^CREATE OR REPLACE TRIGGER/);
  });

  it("appends semicolon when missing", () => {
    const result = rewriteFunction(
      "CREATE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$",
    );
    expect(result.endsWith(";")).toBe(true);
  });

  it("does not double-append semicolon", () => {
    const result = rewriteFunction(
      "CREATE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;",
    );
    expect(result.endsWith(";")).toBe(true);
    expect(result.endsWith(";;")).toBe(false);
  });
});
