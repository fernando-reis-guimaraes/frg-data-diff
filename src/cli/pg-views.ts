import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG_FILENAME } from "../config/load-config";
import {
  resolveGeneratorOptions,
  resolveRuntimeGeneratorOptions,
  type GeneratorOptionInput,
} from "../config/resolve-options";
import { createPool, resolveConnectionParams } from "../db/connection";
import { generatePgViewsDiffSql } from "../diff/pg-views-diff";

const program = new Command();
program
  .name("frg-data-diff pg-views")
  .description(
    "Compare PostgreSQL view definitions and write a SQL diff script.",
  )
  .option("--source-pg-host <host>", "Source database host")
  .option("--source-pg-port <port>", "Source database port", (value) =>
    parseInt(value, 10),
  )
  .option("--source-pg-database <db>", "Source database name")
  .option("--source-pg-user <user>", "Source database user")
  .option(
    "--source-pg-password-env <value>",
    "Source DB password or $ENV_VAR reference",
  )
  .option("--source-pg-ssl", "Use SSL for source database connection")
  .option("--no-source-pg-ssl", "Do not use SSL for source database connection")
  .option("--dest-pg-host <host>", "Destination database host")
  .option("--dest-pg-port <port>", "Destination database port", (value) =>
    parseInt(value, 10),
  )
  .option("--dest-pg-database <db>", "Destination database name")
  .option("--dest-pg-user <user>", "Destination database user")
  .option(
    "--dest-pg-password-env <value>",
    "Destination DB password or $ENV_VAR reference",
  )
  .option("--dest-pg-ssl", "Use SSL for destination database connection")
  .option(
    "--no-dest-pg-ssl",
    "Do not use SSL for destination database connection",
  )
  .option("--schema <schema>", "PostgreSQL schema to compare")
  .option("--view <view...>", "View(s) to include")
  .option("--exclude-view <view...>", "View(s) to exclude")
  .option("--output <file>", "Output diff file path", "frg-views-diff.sql")
  .option("--verbose", "Enable verbose logging")
  .option("--config <file>", "Path to config file", DEFAULT_CONFIG_FILENAME);

program.parse(process.argv);
const opts = program.opts();

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return undefined;
}

async function main() {
  const configFilePath = path.resolve(
    opts["config"] || DEFAULT_CONFIG_FILENAME,
  );
  const configExists = fs.existsSync(configFilePath);
  let generatorConfig = undefined;

  if (configExists) {
    const loadedConfig = loadConfig(configFilePath);
    generatorConfig = loadedConfig.generator;
  }

  let verbose: boolean | undefined;
  if (opts["verbose"]) {
    verbose = true;
  }

  const cliArgs: GeneratorOptionInput = {
    sourcePgHost: opts["sourcePgHost"],
    sourcePgPort: opts["sourcePgPort"],
    sourcePgDatabase: opts["sourcePgDatabase"],
    sourcePgUser: opts["sourcePgUser"],
    sourcePgPassword: opts["sourcePgPasswordEnv"],
    sourcePgSsl: normalizeOptionalBoolean(opts["sourcePgSsl"]),
    destPgHost: opts["destPgHost"],
    destPgPort: opts["destPgPort"],
    destPgDatabase: opts["destPgDatabase"],
    destPgUser: opts["destPgUser"],
    destPgPassword: opts["destPgPasswordEnv"],
    destPgSsl: normalizeOptionalBoolean(opts["destPgSsl"]),
    schema: opts["schema"],
    pgViews: opts["view"],
    pgViewsExclude: opts["excludeView"],
    pgViewsOutput: opts["output"],
    verbose,
  };

  const cleanCliArgs = Object.fromEntries(
    Object.entries(cliArgs).filter(([, value]) => value !== undefined),
  ) as GeneratorOptionInput;

  const resolved = resolveGeneratorOptions(generatorConfig, cleanCliArgs);
  const runtimeResolved = resolveRuntimeGeneratorOptions({
    ...resolved,
    tables: [...resolved.tables],
    excludeTables: [...resolved.excludeTables],
    schemaDiffTables: [...resolved.schemaDiffTables],
    schemaDiffExcludeTables: [...resolved.schemaDiffExcludeTables],
    pgTriggersTables: [...resolved.pgTriggersTables],
    pgTriggersExcludeTables: [...resolved.pgTriggersExcludeTables],
    pgViews: [...resolved.pgViews],
    pgViewsExclude: [...resolved.pgViewsExclude],
    ignoreColumns: [...resolved.ignoreColumns],
  });

  console.log("frg-data-diff: generate pg-views");

  if (!resolved.sourcePgHost || !resolved.destPgHost) {
    console.error(
      "Missing generator configuration. Please run with full arguments or define config.",
    );
    process.exit(1);
  }

  const sourceConnection = resolveConnectionParams(
    {
      host: resolved.sourcePgHost,
      port: resolved.sourcePgPort,
      database: resolved.sourcePgDatabase,
      user: resolved.sourcePgUser,
      password: resolved.sourcePgPassword,
      ssl: runtimeResolved.sourcePgSsl,
    },
    {
      host: "source host",
      port: "source port",
      database: "source database",
      user: "source user",
      password: "source password",
    },
  );

  const destConnection = resolveConnectionParams(
    {
      host: resolved.destPgHost,
      port: resolved.destPgPort,
      database: resolved.destPgDatabase,
      user: resolved.destPgUser,
      password: resolved.destPgPassword,
      ssl: runtimeResolved.destPgSsl,
    },
    {
      host: "dest host",
      port: "dest port",
      database: "dest database",
      user: "dest user",
      password: "dest password",
    },
  );

  const sourcePool = createPool(sourceConnection);
  const destPool = createPool(destConnection);

  try {
    console.log("Preparing pg-views diff...");

    let onVerboseProgress: ((message: string) => void) | undefined;
    if (runtimeResolved.verbose) {
      onVerboseProgress = (message: string) => {
        console.log(message);
      };
    }

    const diffOptions = {
      schema: runtimeResolved.schema,
      views: runtimeResolved.pgViews,
      excludeViews: runtimeResolved.pgViewsExclude,
      verbose: runtimeResolved.verbose,
      onProgress: (message: string) => {
        console.log(message);
      },
      onVerboseProgress,
    };

    const sql = await generatePgViewsDiffSql(sourcePool, destPool, diffOptions);

    const output = runtimeResolved.pgViewsOutput;
    fs.writeFileSync(output, sql, "utf-8");
    console.log(`Wrote views diff SQL to ${output}`);
  } catch (error: any) {
    console.error("Failed to generate pg-views diff.");
    console.error(error.message);
    process.exit(1);
  } finally {
    await sourcePool.end();
    await destPool.end();
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
