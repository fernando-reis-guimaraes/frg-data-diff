#!/usr/bin/env node
/**
 * frg-data-diff generate
 *
 * Compares a source PostgreSQL database against a destination PostgreSQL database
 * and writes a JSON diff file.
 */

import { Command } from "commander";
import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { type Pool, type PoolClient } from "pg";
import {
  findConfigFile,
  loadConfig,
  DEFAULT_CONFIG_FILENAME,
} from "../config/load-config";
import {
  resolveApplyOptions,
  type GeneratorOptionInput,
  resolveGeneratorOptions,
  resolveRuntimeGeneratorOptions,
  type ResolvedGeneratorOptions,
  type RuntimeGeneratorOptions,
} from "../config/resolve-options";
import { buildConfigFile, writeConfig } from "../config/write-config";
import { createPool, resolveConnectionParams } from "../db/connection";
import {
  listTables,
  resolveTablePatternsFromTableLists,
  type ResolvedTablePatterns,
} from "../db/metadata";
import {
  listPgViews,
  resolvePgViewPatternsFromViewLists,
  type ResolvedPgViewPatterns,
} from "../db/pg-views";
import { generateDiff } from "../diff/generate-diff";
import { buildYamlOutputPath, writeYamlFile } from "../diff/write-diff-yaml";
import {
  confirmProceed,
  confirmCreateConfig,
  confirmUpdateConfig,
  confirmDirenvAllow,
} from "../shared/prompts";
import {
  formatSecretValue,
  formatVisibleValue,
  isEnvReference,
} from "../shared/env-values";
import { promptForGeneratorOptions } from "../shared/generator-wizard";
import { buildSqlOutputPath, generateSqlScript } from "../sql/generate-sql";
import {
  buildSchemaSqlOutputPath,
  generateSchemaSqlScript,
} from "../schema-diff/generate-schema-sql";
import { generateSchemaDiff } from "../schema-diff/generate-schema-diff";

const program = new Command();

program
  .name("frg-data-diff generate")
  .description(
    "Compares source and destination PostgreSQL databases and writes JSON, YAML, and optional SQL diff files.",
  )
  .option("--source-pg-host <host>", "Source database host")
  .option("--source-pg-port <port>", "Source database port", (v) =>
    parseInt(v, 10),
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
  .option("--dest-pg-port <port>", "Destination database port", (v) =>
    parseInt(v, 10),
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
  .option("--table <table...>", "Table(s) to include")
  .option("--exclude-table <table...>", "Table(s) to exclude")
  .option(
    "--schema-diff-table <table...>",
    "Table(s) to include for schema diff",
  )
  .option(
    "--schema-diff-exclude-table <table...>",
    "Table(s) to exclude from schema diff",
  )
  .option(
    "--pg-triggers-table <table...>",
    "Table(s) to include for PostgreSQL triggers diff",
  )
  .option(
    "--pg-triggers-exclude-table <table...>",
    "Table(s) to exclude from PostgreSQL triggers diff",
  )
  .option("--pg-view <view...>", "View(s) to include for PostgreSQL views diff")
  .option(
    "--pg-view-exclude <view...>",
    "View(s) to exclude from PostgreSQL views diff",
  )
  .option(
    "--ignore-column <column...>",
    "Column(s) to ignore during comparison",
  )
  .option(
    "--include-deletes",
    "Include deletes in the diff (rows in dest not in source)",
  )
  .option(
    "--skip-missing-pk",
    "Skip tables that have no primary key instead of failing",
  )
  .option("--output <file>", "Output diff file path")
  .option("--schema-diff-output <file>", "Output schema diff file path")
  .option(
    "--pg-triggers-output <file>",
    "Output PostgreSQL triggers diff file path",
  )
  .option("--pg-views-output <file>", "Output PostgreSQL views diff file path")
  .option("--pretty", "Pretty-print the output JSON")
  .option(
    "--generate-pg-triggers",
    "Generate a PostgreSQL triggers and functions diff",
  )
  .option(
    "--no-generate-pg-triggers",
    "Do not generate a PostgreSQL triggers and functions diff",
  )
  .option("--generate-pg-views", "Generate a PostgreSQL views diff")
  .option("--no-generate-pg-views", "Do not generate a PostgreSQL views diff")
  .option("--verbose", "Enable verbose logging")
  .option("--config <file>", "Path to config file", DEFAULT_CONFIG_FILENAME)
  .option("--wizard <value>", "Force the interactive wizard (use true or 1)")
  .option("--yes", "Skip interactive confirmation (for CI/CD)");

program.parse(process.argv);
const opts = program.opts();

async function main() {
  console.log("frg-data-diff: generate");
  console.log("Loading configuration and resolving options...");

  const configFilePath = path.resolve(
    opts["config"] || DEFAULT_CONFIG_FILENAME,
  );
  const configExists = fs.existsSync(configFilePath);
  const hasCliArgs = hasAnyGeneratorArgs(process.argv.slice(2));
  const wizardRequested = isWizardRequested(opts["wizard"]);

  let loadedConfig: ReturnType<typeof loadConfig> | undefined;
  let generatorConfig: ReturnType<typeof loadConfig>["generator"] | undefined;
  let configWritten = configExists;
  let configCreatedThisRun = false;
  let envrcWrittenDuringWizard = false;
  let configUpdatedThisRun = false;

  if (configExists) {
    loadedConfig = loadConfig(configFilePath);
    generatorConfig = loadedConfig.generator;
  }
  let wizardRan = false;

  // Build resolved options from CLI args + config
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
    tables: opts["table"],
    excludeTables: opts["excludeTable"],
    schemaDiffTables: opts["schemaDiffTable"],
    schemaDiffExcludeTables: opts["schemaDiffExcludeTable"],
    pgTriggersTables: opts["pgTriggersTable"],
    pgTriggersExcludeTables: opts["pgTriggersExcludeTable"],
    pgViews: opts["pgView"],
    pgViewsExclude: opts["pgViewExclude"],
    ignoreColumns: opts["ignoreColumn"],
    includeDeletes: opts["includeDeletes"] ? true : undefined,
    skipMissingPk: opts["skipMissingPk"] ? true : undefined,
    output: opts["output"],
    schemaDiffOutput: opts["schemaDiffOutput"],
    pgTriggersOutput: opts["pgTriggersOutput"],
    pgViewsOutput: opts["pgViewsOutput"],
    pretty: opts["pretty"] ? true : undefined,
    generatePgTriggers: normalizeOptionalBoolean(opts["generatePgTriggers"]),
    generatePgViews: normalizeOptionalBoolean(opts["generatePgViews"]),
    verbose: opts["verbose"] ? true : undefined,
  };

  // Remove undefined values
  let cleanCliArgs = Object.fromEntries(
    Object.entries(cliArgs).filter(([, v]) => v !== undefined),
  ) as GeneratorOptionInput;

  if (
    (!configExists && !hasCliArgs && !opts["yes"]) ||
    (configExists && wizardRequested)
  ) {
    const wizardDefaults = resolveGeneratorOptions(
      generatorConfig,
      cleanCliArgs,
    );
    const wizardArgs = await promptForGeneratorOptions(
      wizardDefaults,
      undefined,
      {
        onEnvrcWrite: () => {
          envrcWrittenDuringWizard = true;
        },
      },
    );
    wizardRan = true;
    cleanCliArgs = {
      ...cleanCliArgs,
      ...wizardArgs,
    };
  }

  const resolved = resolveGeneratorOptions(generatorConfig, cleanCliArgs);
  const requestedTables = [...resolved.tables];
  const requestedExcludeTables =
    cleanCliArgs.excludeTables === null ? null : [...resolved.excludeTables];
  const requestedSchemaDiffTables = [...resolved.schemaDiffTables];
  const requestedSchemaDiffExcludeTables =
    cleanCliArgs.schemaDiffExcludeTables === null
      ? null
      : [...resolved.schemaDiffExcludeTables];
  const requestedPgTriggersTables = [...resolved.pgTriggersTables];
  const requestedPgTriggersExcludeTables =
    cleanCliArgs.pgTriggersExcludeTables === null
      ? null
      : [...resolved.pgTriggersExcludeTables];
  const requestedPgViews = [...resolved.pgViews];
  let requestedPgViewsExclude: string[] | null;
  if (cleanCliArgs.pgViewsExclude === null) {
    requestedPgViewsExclude = null;
  } else {
    requestedPgViewsExclude = [...resolved.pgViewsExclude];
  }
  const requestedIgnoreColumns =
    cleanCliArgs.ignoreColumns === null ? null : [...resolved.ignoreColumns];
  const runtimeBaseResolved = resolveRuntimeGeneratorOptions({
    ...resolved,
    tables: requestedTables,
    excludeTables: resolved.excludeTables,
    schemaDiffTables: requestedSchemaDiffTables,
    schemaDiffExcludeTables: resolved.schemaDiffExcludeTables,
    pgTriggersTables: requestedPgTriggersTables,
    pgTriggersExcludeTables: resolved.pgTriggersExcludeTables,
    pgViews: requestedPgViews,
    pgViewsExclude: resolved.pgViewsExclude,
    ignoreColumns: resolved.ignoreColumns,
  });

  // Validate required values
  if (
    !resolved.sourcePgHost ||
    !resolved.sourcePgDatabase ||
    !resolved.sourcePgUser ||
    !resolved.sourcePgPassword
  ) {
    console.error(
      "Error: Missing required source database connection options.",
    );
    console.error(
      "Provide --source-pg-host, --source-pg-database, --source-pg-user, --source-pg-password-env",
    );
    console.error("or configure them in .frg-data-diff.config.json");
    process.exit(1);
  }

  if (
    !resolved.destPgHost ||
    !resolved.destPgDatabase ||
    !resolved.destPgUser ||
    !resolved.destPgPassword
  ) {
    console.error(
      "Error: Missing required destination database connection options.",
    );
    console.error(
      "Provide --dest-pg-host, --dest-pg-database, --dest-pg-user, --dest-pg-password-env",
    );
    console.error("or configure them in .frg-data-diff.config.json");
    process.exit(1);
  }

  if (!resolved.tables || resolved.tables.length === 0) {
    console.error(
      "Error: No tables specified. Use --table <table> or configure tables in .frg-data-diff.config.json",
    );
    process.exit(1);
  }

  const configToWrite = buildConfigFile(
    {
      ...resolved,
      tables: requestedTables,
      excludeTables: requestedExcludeTables,
      schemaDiffTables: requestedSchemaDiffTables,
      schemaDiffExcludeTables: requestedSchemaDiffExcludeTables,
      pgTriggersTables: requestedPgTriggersTables,
      pgTriggersExcludeTables: requestedPgTriggersExcludeTables,
      pgViews: requestedPgViews,
      pgViewsExclude: requestedPgViewsExclude,
      ignoreColumns: requestedIgnoreColumns,
    },
    resolveApplyOptions(loadedConfig?.apply, {
      destPgHost: resolved.destPgHost,
      destPgPort: resolved.destPgPort,
      destPgDatabase: resolved.destPgDatabase,
      destPgUser: resolved.destPgUser,
      destPgPassword: resolved.destPgPassword,
      destPgSsl: resolved.destPgSsl,
    }),
  );

  if ((wizardRan || (!configExists && hasCliArgs)) && !opts["yes"]) {
    if (configExists) {
      const shouldUpdate = await confirmUpdateConfig();
      if (shouldUpdate) {
        writeConfig(configFilePath, configToWrite);
        configWritten = true;
        configUpdatedThisRun = true;
        console.log(`Config updated: ${configFilePath}`);
      }
    } else {
      const shouldCreate = await confirmCreateConfig();
      if (shouldCreate) {
        writeConfig(configFilePath, configToWrite);
        configWritten = true;
        configCreatedThisRun = true;
        console.log(`Config written to: ${configFilePath}`);
      }
    }

    console.log("Continuing with the requested operation...");
  }

  if (
    !opts["yes"] &&
    (envrcWrittenDuringWizard || configCreatedThisRun || configUpdatedThisRun)
  ) {
    await maybeRunDirenvAllow();
  }

  if (wizardRan && !opts["yes"]) {
    const shouldRunDiff = await confirmProceed(
      "\nGenerate the diff now? [yes]: ",
      true,
    );
    if (!shouldRunDiff) {
      console.log("Stopped after wizard setup.");
      process.exit(0);
    }
  }

  if (!wizardRan && !configExists && !opts["yes"]) {
    const proceed = await confirmProceed(
      '\nProceed with generating the diff now? Type "yes" to continue: ',
    );
    if (!proceed) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  const sourceConnection = resolveConnectionParams(
    {
      host: resolved.sourcePgHost,
      port: resolved.sourcePgPort,
      database: resolved.sourcePgDatabase,
      user: resolved.sourcePgUser,
      password: resolved.sourcePgPassword,
      ssl: runtimeBaseResolved.sourcePgSsl,
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
      ssl: runtimeBaseResolved.destPgSsl,
    },
    {
      host: "destination host",
      port: "destination port",
      database: "destination database",
      user: "destination user",
      password: "destination password",
    },
  );

  const sourcePool = createPool(sourceConnection);
  const destPool = createPool(destConnection);
  attachPoolErrorLogger(sourcePool, "source");
  attachPoolErrorLogger(destPool, "destination");

  try {
    console.log("Preparing database connection pools...");
    console.log("Resolving requested table patterns across both databases...");

    const resolvedTablePatterns = await resolveGeneratorTablePatterns(
      sourcePool,
      destPool,
      runtimeBaseResolved,
      (message) => {
        console.log(message);
      },
    );
    const expandedTables = resolvedTablePatterns.data;
    const expandedSchemaDiffTables = resolvedTablePatterns.schema;
    const expandedPgTriggersTables = resolvedTablePatterns.pgTriggers;
    const expandedPgViews = resolvedTablePatterns.pgViews;

    console.log(
      `Resolved ${expandedTables.tables.length} data table(s), ${expandedSchemaDiffTables.tables.length} schema table(s), ${expandedPgTriggersTables.tables.length} PostgreSQL trigger table(s), and ${expandedPgViews.views.length} PostgreSQL view(s).`,
    );

    const runtimeResolved: RuntimeGeneratorOptions = {
      ...runtimeBaseResolved,
      tables: expandedTables.tables,
      excludeTables: expandedTables.excludedTables,
      schemaDiffTables: expandedSchemaDiffTables.tables,
      schemaDiffExcludeTables: expandedSchemaDiffTables.excludedTables,
      pgTriggersTables: expandedPgTriggersTables.tables,
      pgTriggersExcludeTables: expandedPgTriggersTables.excludedTables,
      pgViews: expandedPgViews.views,
      pgViewsExclude: expandedPgViews.excludedViews,
    };

    const logProgress = (message: string) => {
      console.log(message);
    };

    const logVerboseProgress = runtimeResolved.verbose
      ? (message: string) => {
          console.log(message);
        }
      : undefined;

    // Print resolved plan
    printResolvedPlan(
      resolved,
      runtimeResolved.tables,
      runtimeResolved.excludeTables,
      runtimeResolved.schemaDiffTables,
      runtimeResolved.schemaDiffExcludeTables,
      runtimeResolved.pgTriggersTables,
      runtimeResolved.pgTriggersExcludeTables,
      runtimeResolved.pgViews,
      runtimeResolved.pgViewsExclude,
      sourceConnection,
      destConnection,
    );

    console.log("Connecting to databases...");
    console.log(
      `Comparing ${runtimeResolved.tables.length} data table(s), ${runtimeResolved.schemaDiffTables.length} schema table(s), ${runtimeResolved.pgTriggersTables.length} PostgreSQL trigger table(s), and ${runtimeResolved.pgViews.length} PostgreSQL view(s)...`,
    );
    console.log("Starting data and schema diff generation...");

    const [diff, schemaDiff] = await Promise.all([
      generateDiff(sourcePool, destPool, {
        schema: runtimeResolved.schema,
        tables: runtimeResolved.tables,
        excludeTables: runtimeResolved.excludeTables,
        ignoreColumns: runtimeResolved.ignoreColumns,
        tablesWhereDataFilters: runtimeResolved.tablesWhereDataFilters,
        includeDeletes: runtimeResolved.includeDeletes,
        skipMissingPk: runtimeResolved.skipMissingPk,
        verbose: runtimeResolved.verbose,
        onProgress: logProgress,
        onVerboseProgress: logVerboseProgress,
      }),
      generateSchemaDiff(sourcePool, destPool, {
        schema: runtimeResolved.schema,
        tables: runtimeResolved.schemaDiffTables,
        excludeTables: runtimeResolved.schemaDiffExcludeTables,
        verbose: runtimeResolved.verbose,
        onProgress: logProgress,
        onVerboseProgress: logVerboseProgress,
      }),
    ]);

    const outputPath = path.resolve(runtimeResolved.output);
    const yamlOutputPath = path.resolve(
      buildYamlOutputPath(runtimeResolved.output),
    );
    const sqlOutputPath = path.resolve(
      buildSqlOutputPath(runtimeResolved.output),
    );
    const schemaDiffOutputPath = path.resolve(runtimeResolved.schemaDiffOutput);
    const schemaDiffYamlOutputPath = path.resolve(
      buildYamlOutputPath(runtimeResolved.schemaDiffOutput),
    );
    const schemaDiffSqlOutputPath = path.resolve(
      buildSchemaSqlOutputPath(runtimeResolved.schemaDiffOutput),
    );
    const pgTriggersOutputPath = path.resolve(runtimeResolved.pgTriggersOutput);
    const pgViewsOutputPath = path.resolve(runtimeResolved.pgViewsOutput);

    console.log("Writing JSON and YAML diff artifacts...");

    const dataContent = runtimeResolved.pretty
      ? JSON.stringify(diff, null, 2) + "\n"
      : JSON.stringify(diff) + "\n";
    const schemaContent = runtimeResolved.pretty
      ? JSON.stringify(schemaDiff, null, 2) + "\n"
      : JSON.stringify(schemaDiff) + "\n";

    fs.writeFileSync(outputPath, dataContent, "utf-8");
    writeYamlFile(yamlOutputPath, diff);
    fs.writeFileSync(schemaDiffOutputPath, schemaContent, "utf-8");
    writeYamlFile(schemaDiffYamlOutputPath, schemaDiff);

    console.log("Generating schema SQL script...");

    const schemaSqlResult = generateSchemaSqlScript(schemaDiff, {
      transaction: true,
      includeDrops: true,
      onProgress: logProgress,
    });
    fs.writeFileSync(schemaDiffSqlOutputPath, schemaSqlResult.sql, "utf-8");

    let sqlGenerated = false;
    let pgTriggersSqlGenerated = false;
    let pgViewsSqlGenerated = false;

    console.log("\nData diff summary:");
    console.log(`  Tables compared: ${diff.summary.tablesCompared}`);
    console.log(`  Inserts: ${diff.summary.inserts}`);
    console.log(`  Updates: ${diff.summary.updates}`);
    console.log(`  Deletes: ${diff.summary.deletes}`);
    if (diff.summary.skippedTables.length > 0) {
      console.log(`  Skipped tables: ${diff.summary.skippedTables.join(", ")}`);
    }

    console.log("\nSchema diff summary:");
    console.log(`  Tables compared: ${schemaDiff.summary.tablesCompared}`);
    console.log(`  Tables to create: ${schemaDiff.summary.tablesToCreate}`);
    console.log(`  Tables to drop: ${schemaDiff.summary.tablesToDrop}`);
    console.log(`  Columns to add: ${schemaDiff.summary.columnsToAdd}`);
    console.log(`  Columns to alter: ${schemaDiff.summary.columnsToAlter}`);
    console.log(`  Columns to drop: ${schemaDiff.summary.columnsToDrop}`);
    console.log(
      `  Primary keys to change: ${schemaDiff.summary.primaryKeysToChange}`,
    );

    let shouldGenerateSql = false;
    if (runtimeResolved.generateSql !== undefined) {
      shouldGenerateSql = runtimeResolved.generateSql;
    } else if (shouldAskInteractiveQuestion(opts["yes"])) {
      shouldGenerateSql = await confirmProceed(
        "\nGenerate a SQL script from this diff now? [yes]: ",
        true,
      );
    }

    if (shouldGenerateSql) {
      console.log("Generating data SQL script...");

      const sqlResult = generateSqlScript(diff, {
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: runtimeResolved.includeDeletes,
        transaction: true,
        onProgress: logProgress,
      });
      fs.writeFileSync(sqlOutputPath, sqlResult.sql, "utf-8");
      sqlGenerated = true;
    }

    let shouldGeneratePgTriggers = false;
    if (runtimeResolved.generatePgTriggers !== undefined) {
      shouldGeneratePgTriggers = runtimeResolved.generatePgTriggers;
    } else if (shouldAskInteractiveQuestion(opts["yes"])) {
      shouldGeneratePgTriggers = await confirmProceed(
        "\nGenerate a PostgreSQL triggers and functions diff? (SQL script) [yes]: ",
        true,
      );
    }

    if (shouldGeneratePgTriggers) {
      console.log("\nGenerating PostgreSQL triggers and functions diff...");
      const pgTriggersArgs: string[] = [];
      if (configWritten) {
        pgTriggersArgs.push(
          "--config",
          path.relative(process.cwd(), configFilePath) ||
            DEFAULT_CONFIG_FILENAME,
        );
      } else {
        // Pass all resolved args down manually if no config is available.
        // This is a rare edge case, usually we write the config.
        pgTriggersArgs.push("--source-pg-host", resolved.sourcePgHost);
        pgTriggersArgs.push("--source-pg-port", String(resolved.sourcePgPort));
        pgTriggersArgs.push("--source-pg-database", resolved.sourcePgDatabase);
        pgTriggersArgs.push("--source-pg-user", resolved.sourcePgUser);
        if (isEnvReference(resolved.sourcePgPassword)) {
          pgTriggersArgs.push(
            "--source-pg-password-env",
            resolved.sourcePgPassword,
          );
        }
        if (resolved.sourcePgSsl) pgTriggersArgs.push("--source-pg-ssl");
        else pgTriggersArgs.push("--no-source-pg-ssl");

        pgTriggersArgs.push("--dest-pg-host", resolved.destPgHost);
        pgTriggersArgs.push("--dest-pg-port", String(resolved.destPgPort));
        pgTriggersArgs.push("--dest-pg-database", resolved.destPgDatabase);
        pgTriggersArgs.push("--dest-pg-user", resolved.destPgUser);
        if (isEnvReference(resolved.destPgPassword)) {
          pgTriggersArgs.push(
            "--dest-pg-password-env",
            resolved.destPgPassword,
          );
        }
        if (resolved.destPgSsl) pgTriggersArgs.push("--dest-pg-ssl");
        else pgTriggersArgs.push("--no-dest-pg-ssl");

        pgTriggersArgs.push("--schema", resolved.schema);
        for (const t of runtimeResolved.pgTriggersTables)
          pgTriggersArgs.push("--table", t);
        for (const t of runtimeResolved.pgTriggersExcludeTables)
          pgTriggersArgs.push("--exclude-table", t);
        pgTriggersArgs.push("--output", runtimeResolved.pgTriggersOutput);
      }

      if (runtimeResolved.verbose) {
        pgTriggersArgs.push("--verbose");
      }

      const pgTriggersCommandPath = path.join(__dirname, "pg-triggers.js");
      const res = spawnSync(
        process.execPath,
        [pgTriggersCommandPath, ...pgTriggersArgs],
        {
          stdio: "inherit",
        },
      );
      if (res.status !== 0) {
        console.error("Warning: pg-triggers diff generation failed.");
      } else {
        pgTriggersSqlGenerated = true;
      }
    }

    let shouldGeneratePgViews = false;
    if (runtimeResolved.generatePgViews !== undefined) {
      shouldGeneratePgViews = runtimeResolved.generatePgViews;
    } else if (shouldAskInteractiveQuestion(opts["yes"])) {
      shouldGeneratePgViews = await confirmProceed(
        "\nGenerate a PostgreSQL views diff? (SQL script) [yes]: ",
        true,
      );
    }

    if (shouldGeneratePgViews) {
      console.log("\nGenerating PostgreSQL views diff...");
      const pgViewsArgs: string[] = [];
      if (configWritten) {
        pgViewsArgs.push(
          "--config",
          path.relative(process.cwd(), configFilePath) ||
            DEFAULT_CONFIG_FILENAME,
        );
      } else {
        // Pass all resolved args down manually if no config is available.
        // This is a rare edge case, usually we write the config.
        pgViewsArgs.push("--source-pg-host", resolved.sourcePgHost);
        pgViewsArgs.push("--source-pg-port", String(resolved.sourcePgPort));
        pgViewsArgs.push("--source-pg-database", resolved.sourcePgDatabase);
        pgViewsArgs.push("--source-pg-user", resolved.sourcePgUser);
        if (isEnvReference(resolved.sourcePgPassword)) {
          pgViewsArgs.push(
            "--source-pg-password-env",
            resolved.sourcePgPassword,
          );
        }
        if (resolved.sourcePgSsl) {
          pgViewsArgs.push("--source-pg-ssl");
        } else {
          pgViewsArgs.push("--no-source-pg-ssl");
        }

        pgViewsArgs.push("--dest-pg-host", resolved.destPgHost);
        pgViewsArgs.push("--dest-pg-port", String(resolved.destPgPort));
        pgViewsArgs.push("--dest-pg-database", resolved.destPgDatabase);
        pgViewsArgs.push("--dest-pg-user", resolved.destPgUser);
        if (isEnvReference(resolved.destPgPassword)) {
          pgViewsArgs.push("--dest-pg-password-env", resolved.destPgPassword);
        }
        if (resolved.destPgSsl) {
          pgViewsArgs.push("--dest-pg-ssl");
        } else {
          pgViewsArgs.push("--no-dest-pg-ssl");
        }

        pgViewsArgs.push("--schema", resolved.schema);
        for (const viewName of runtimeResolved.pgViews) {
          pgViewsArgs.push("--view", viewName);
        }
        for (const viewName of runtimeResolved.pgViewsExclude) {
          pgViewsArgs.push("--exclude-view", viewName);
        }
        pgViewsArgs.push("--output", runtimeResolved.pgViewsOutput);
      }

      if (runtimeResolved.verbose) {
        pgViewsArgs.push("--verbose");
      }

      const pgViewsCommandPath = path.join(__dirname, "pg-views.js");
      const res = spawnSync(
        process.execPath,
        [pgViewsCommandPath, ...pgViewsArgs],
        {
          stdio: "inherit",
        },
      );
      if (res.status !== 0) {
        console.error("Warning: pg-views diff generation failed.");
      } else {
        pgViewsSqlGenerated = true;
      }
    }

    console.log(
      "\nReview the data diff and schema SQL carefully before applying anything.",
    );
    if (!sqlGenerated) {
      console.log("\nGenerate SQL Diff:");
      console.log(
        buildSqlCommand(
          runtimeResolved.output,
          configFilePath,
          configWritten,
          runtimeResolved.includeDeletes,
        ),
      );
    }
    console.log("\nApply command:");
    console.log(
      buildApplyCommand(runtimeResolved, configFilePath, configWritten),
    );

    console.log("");
    console.log(`Data diff written to: ${outputPath}`);
    console.log(`Data YAML written to: ${yamlOutputPath}`);
    if (sqlGenerated) {
      console.log(`Data SQL written to: ${sqlOutputPath}`);
    }
    console.log(`Schema diff written to: ${schemaDiffOutputPath}`);
    console.log(`Schema YAML written to: ${schemaDiffYamlOutputPath}`);
    console.log(`Schema SQL written to: ${schemaDiffSqlOutputPath}`);
    if (pgTriggersSqlGenerated) {
      console.log(
        `PostgreSQL triggers SQL written to: ${pgTriggersOutputPath}`,
      );
    }
    if (pgViewsSqlGenerated) {
      console.log(`PostgreSQL views SQL written to: ${pgViewsOutputPath}`);
    }
    console.log("");
  } finally {
    await sourcePool.end();
    await destPool.end();
  }
}

function buildSqlCommand(
  output: string,
  configFilePath: string,
  configAvailable: boolean,
  applyDeletes: boolean,
): string {
  if (configAvailable) {
    return [
      "npx frg-data-diff sql",
      `--config ${shellEscapeArg(path.relative(process.cwd(), configFilePath) || DEFAULT_CONFIG_FILENAME)}`,
      `--input ${shellEscapeArg(output)}`,
      applyDeletes ? "--apply-deletes" : "--no-apply-deletes",
      "--yes",
    ].join(" \\\n  ");
  }

  return [
    "npx frg-data-diff sql",
    `--input ${shellEscapeArg(output)}`,
    applyDeletes ? "--apply-deletes" : "--no-apply-deletes",
    "--yes",
  ].join(" \\\n  ");
}

async function maybeRunDirenvAllow(): Promise<void> {
  if (!isDirenvAvailable()) return;

  const shouldAllow = await confirmDirenvAllow();
  if (!shouldAllow) return;

  try {
    execFileSync("direnv", ["allow"], { stdio: "inherit" });
  } catch (err) {
    console.warn('Warning: failed to run "direnv allow".');
    if (err instanceof Error && err.message) {
      console.warn(err.message);
    }
  }
}

function isDirenvAvailable(): boolean {
  const result = spawnSync("direnv", ["version"], { stdio: "ignore" });
  return result.status === 0;
}

function isWizardRequested(value: unknown): boolean {
  return value === "true" || value === "1";
}

function buildApplyCommand(
  resolved: ResolvedGeneratorOptions,
  configFilePath: string,
  configAvailable: boolean,
): string {
  if (configAvailable) {
    return [
      "npx frg-data-diff apply",
      `--config ${shellEscapeArg(path.relative(process.cwd(), configFilePath) || DEFAULT_CONFIG_FILENAME)}`,
      `--input ${shellEscapeArg(resolved.output)}`,
      "--execute",
    ].join(" \\\n  ");
  }

  const parts = [
    "npx frg-data-diff apply",
    `--dest-pg-host ${shellEscapeArg(resolved.destPgHost)}`,
    `--dest-pg-port ${resolved.destPgPort}`,
    `--dest-pg-database ${shellEscapeArg(resolved.destPgDatabase)}`,
    `--dest-pg-user ${shellEscapeArg(resolved.destPgUser)}`,
    resolved.destPgSsl ? "--dest-pg-ssl" : "--no-dest-pg-ssl",
    `--input ${shellEscapeArg(resolved.output)}`,
    "--execute",
  ];

  if (isEnvReference(resolved.destPgPassword)) {
    parts.splice(
      5,
      0,
      `--dest-pg-password-env ${shellEscapeArg(resolved.destPgPassword)}`,
    );
  }

  return parts.join(" \\\n  ");
}

interface ResolvedGeneratorTablePatternGroups {
  data: ResolvedTablePatterns;
  schema: ResolvedTablePatterns;
  pgTriggers: ResolvedTablePatterns;
  pgViews: ResolvedPgViewPatterns;
}

type TablePatternAvailability = "common" | "either";

async function resolveGeneratorTablePatterns(
  sourcePool: Pool,
  destPool: Pool,
  resolved: RuntimeGeneratorOptions,
  logProgress: (message: string) => void,
): Promise<ResolvedGeneratorTablePatternGroups> {
  let sourceClient: PoolClient | undefined;
  let destClient: PoolClient | undefined;

  try {
    sourceClient = await runLoggedAsyncStep(
      "connecting to source database for table resolution",
      () => sourcePool.connect(),
      logProgress,
    );
    destClient = await runLoggedAsyncStep(
      "connecting to destination database for table resolution",
      () => destPool.connect(),
      logProgress,
    );

    const sourceTables = await listTablesWithProgress(
      sourceClient,
      resolved.schema,
      "source",
      logProgress,
    );
    const destTables = await listTablesWithProgress(
      destClient,
      resolved.schema,
      "destination",
      logProgress,
    );
    const sourceViews = await listPgViewsWithProgress(
      sourceClient,
      resolved.schema,
      "source",
      logProgress,
    );
    const destViews = await listPgViewsWithProgress(
      destClient,
      resolved.schema,
      "destination",
      logProgress,
    );

    const data = resolveTablePatternGroup(
      "data",
      sourceTables,
      destTables,
      resolved.tables,
      resolved.excludeTables,
      "common",
      logProgress,
    );
    const schema = resolveTablePatternGroup(
      "schema diff",
      sourceTables,
      destTables,
      resolved.schemaDiffTables,
      resolved.schemaDiffExcludeTables,
      "either",
      logProgress,
    );
    const pgTriggers = resolveTablePatternGroup(
      "PostgreSQL trigger",
      sourceTables,
      destTables,
      resolved.pgTriggersTables,
      resolved.pgTriggersExcludeTables,
      "common",
      logProgress,
    );
    const pgViews = resolveViewPatternGroup(
      "PostgreSQL view",
      sourceViews,
      destViews,
      resolved.pgViews,
      resolved.pgViewsExclude,
      logProgress,
    );

    return { data, schema, pgTriggers, pgViews };
  } finally {
    if (destClient !== undefined) {
      destClient.release();
      logProgress(
        "[table resolution] released destination metadata connection.",
      );
    }
    if (sourceClient !== undefined) {
      sourceClient.release();
      logProgress("[table resolution] released source metadata connection.");
    }
  }
}

async function listTablesWithProgress(
  client: PoolClient,
  schema: string,
  databaseLabel: string,
  logProgress: (message: string) => void,
): Promise<string[]> {
  const tables = await runLoggedAsyncStep(
    `scanning ${databaseLabel} tables in schema "${schema}"`,
    () => listTables(client, schema),
    logProgress,
  );

  logProgress(
    `[table resolution] ${databaseLabel} database returned ${tables.length} base table(s).`,
  );
  logProgress(
    `[table resolution] ${databaseLabel} table preview: ${formatStringList(tables)}`,
  );

  return tables;
}

async function listPgViewsWithProgress(
  client: PoolClient,
  schema: string,
  databaseLabel: string,
  logProgress: (message: string) => void,
): Promise<string[]> {
  const views = await runLoggedAsyncStep(
    `scanning ${databaseLabel} views in schema "${schema}"`,
    () => listPgViews(client, schema),
    logProgress,
  );

  logProgress(
    `[view resolution] ${databaseLabel} database returned ${views.length} view(s).`,
  );
  logProgress(
    `[view resolution] ${databaseLabel} view preview: ${formatStringList(views)}`,
  );

  return views;
}

function resolveTablePatternGroup(
  label: string,
  sourceTables: string[],
  destTables: string[],
  includePatterns: string[],
  excludePatterns: string[],
  availability: TablePatternAvailability,
  logProgress: (message: string) => void,
): ResolvedTablePatterns {
  const startedAt = Date.now();
  logProgress(
    `[table resolution] resolving ${label} patterns against ${formatAvailability(availability)}.`,
  );
  logProgress(
    `[table resolution] ${label} include patterns: ${formatStringList(includePatterns)}`,
  );
  logProgress(
    `[table resolution] ${label} exclude patterns: ${formatStringList(excludePatterns)}`,
  );

  try {
    let result: ResolvedTablePatterns;
    if (availability === "either") {
      result = resolveTablePatternsFromTableLists(
        sourceTables,
        destTables,
        includePatterns,
        excludePatterns,
        { availability: "either" },
      );
    } else {
      result = resolveTablePatternsFromTableLists(
        sourceTables,
        destTables,
        includePatterns,
        excludePatterns,
      );
    }

    logProgress(
      `[table resolution] resolved ${label} patterns in ${formatDuration(Date.now() - startedAt)}.`,
    );
    logProgress(
      `[table resolution] ${label} tables: ${formatStringList(result.tables)}`,
    );
    if (result.excludedTables.length > 0) {
      logProgress(
        `[table resolution] ${label} excluded tables: ${formatStringList(result.excludedTables)}`,
      );
    }

    return result;
  } catch (error) {
    console.error(
      `[table resolution] failed to resolve ${label} patterns after ${formatDuration(
        Date.now() - startedAt,
      )}.`,
    );
    throw error;
  }
}

function resolveViewPatternGroup(
  label: string,
  sourceViews: string[],
  destViews: string[],
  includePatterns: string[],
  excludePatterns: string[],
  logProgress: (message: string) => void,
): ResolvedPgViewPatterns {
  const startedAt = Date.now();
  logProgress(`[view resolution] resolving ${label} patterns.`);
  logProgress(
    `[view resolution] ${label} include patterns: ${formatStringList(includePatterns)}`,
  );
  logProgress(
    `[view resolution] ${label} exclude patterns: ${formatStringList(excludePatterns)}`,
  );

  try {
    const result = resolvePgViewPatternsFromViewLists(
      sourceViews,
      destViews,
      includePatterns,
      excludePatterns,
    );

    logProgress(
      `[view resolution] resolved ${label} patterns in ${formatDuration(Date.now() - startedAt)}.`,
    );
    logProgress(
      `[view resolution] ${label} views: ${formatStringList(result.views)}`,
    );
    if (result.excludedViews.length > 0) {
      logProgress(
        `[view resolution] ${label} excluded views: ${formatStringList(result.excludedViews)}`,
      );
    }

    return result;
  } catch (error) {
    console.error(
      `[view resolution] failed to resolve ${label} patterns after ${formatDuration(
        Date.now() - startedAt,
      )}.`,
    );
    throw error;
  }
}

async function runLoggedAsyncStep<T>(
  label: string,
  action: () => Promise<T>,
  logProgress: (message: string) => void,
): Promise<T> {
  const startedAt = Date.now();
  logProgress(`[table resolution] ${label}...`);

  try {
    const result = await action();
    logProgress(
      `[table resolution] ${label} completed in ${formatDuration(Date.now() - startedAt)}.`,
    );
    return result;
  } catch (error) {
    console.error(
      `[table resolution] ${label} failed after ${formatDuration(
        Date.now() - startedAt,
      )}.`,
    );
    throw error;
  }
}

function formatAvailability(availability: TablePatternAvailability): string {
  if (availability === "either") {
    return "either database";
  }
  return "both databases";
}

function formatStringList(values: string[], maxItems: number = 25): string {
  if (values.length === 0) {
    return "(none)";
  }

  const visibleValues = values.slice(0, maxItems);
  const visible = visibleValues.join(", ");
  if (values.length > maxItems) {
    const remaining = values.length - maxItems;
    return `${visible}, ... (${remaining} more)`;
  }

  return visible;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function attachPoolErrorLogger(pool: Pool, label: string): void {
  pool.on("error", (error) => {
    console.error(`[${label} pool] idle PostgreSQL client error:`);
    logErrorDetails(error);
  });
}

function logErrorDetails(error: unknown): void {
  if (error instanceof Error) {
    if (error.stack) {
      console.error(error.stack);
      return;
    }

    console.error(error.message);
    return;
  }

  console.error(String(error));
}

function shellEscapeArg(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function printResolvedPlan(
  resolved: ResolvedGeneratorOptions,
  expandedTables: string[],
  expandedExcludeTables: string[],
  expandedSchemaDiffTables: string[],
  expandedSchemaDiffExcludeTables: string[],
  expandedPgTriggersTables: string[],
  expandedPgTriggersExcludeTables: string[],
  expandedPgViews: string[],
  expandedPgViewsExclude: string[],
  sourceConnection: {
    host: string;
    port: number;
    database: string;
    user: string;
  },
  destConnection: {
    host: string;
    port: number;
    database: string;
    user: string;
  },
): void {
  console.log("\ntool:");
  console.log("  frg-data-diff generate");
  console.log("\nsource:");
  console.log(
    `  host: ${formatVisibleValue(resolved.sourcePgHost, sourceConnection.host)}`,
  );
  console.log(
    `  port: ${typeof resolved.sourcePgPort === "string" ? `${resolved.sourcePgPort} -> ${sourceConnection.port}` : sourceConnection.port}`,
  );
  console.log(
    `  database: ${formatVisibleValue(resolved.sourcePgDatabase, sourceConnection.database)}`,
  );
  console.log(
    `  user: ${formatVisibleValue(resolved.sourcePgUser, sourceConnection.user)}`,
  );
  console.log(
    `  password: ${formatSecretValue(String(resolved.sourcePgPassword))}`,
  );
  console.log(`  ssl: ${resolved.sourcePgSsl}`);
  console.log("\ndest:");
  console.log(
    `  host: ${formatVisibleValue(resolved.destPgHost, destConnection.host)}`,
  );
  console.log(
    `  port: ${typeof resolved.destPgPort === "string" ? `${resolved.destPgPort} -> ${destConnection.port}` : destConnection.port}`,
  );
  console.log(
    `  database: ${formatVisibleValue(resolved.destPgDatabase, destConnection.database)}`,
  );
  console.log(
    `  user: ${formatVisibleValue(resolved.destPgUser, destConnection.user)}`,
  );
  console.log(
    `  password: ${formatSecretValue(String(resolved.destPgPassword))}`,
  );
  console.log(`  ssl: ${resolved.destPgSsl}`);
  console.log("\nschema: " + resolved.schema);
  console.log("tables: " + resolved.tables.join(", "));
  if (expandedTables.join(",") !== resolved.tables.join(",")) {
    console.log("expanded tables: " + expandedTables.join(", "));
  }
  if (resolved.excludeTables.length > 0) {
    console.log("exclude tables: " + resolved.excludeTables.join(", "));
  }
  if (expandedExcludeTables.join(",") !== resolved.excludeTables.join(",")) {
    console.log("expanded exclude tables: " + expandedExcludeTables.join(", "));
  }
  if (resolved.ignoreColumns.length > 0) {
    console.log("ignored columns: " + resolved.ignoreColumns.join(", "));
  }
  console.log("output: " + resolved.output);
  console.log("yaml output: " + buildYamlOutputPath(resolved.output));
  console.log("schema diff tables: " + resolved.schemaDiffTables.join(", "));
  if (
    expandedSchemaDiffTables.join(",") !== resolved.schemaDiffTables.join(",")
  ) {
    console.log(
      "expanded schema diff tables: " + expandedSchemaDiffTables.join(", "),
    );
  }
  if (resolved.schemaDiffExcludeTables.length > 0) {
    console.log(
      "schema diff exclude tables: " +
        resolved.schemaDiffExcludeTables.join(", "),
    );
  }
  if (
    expandedSchemaDiffExcludeTables.join(",") !==
    resolved.schemaDiffExcludeTables.join(",")
  ) {
    console.log(
      "expanded schema diff exclude tables: " +
        expandedSchemaDiffExcludeTables.join(", "),
    );
  }
  console.log("schema diff output: " + resolved.schemaDiffOutput);
  console.log(
    "schema diff yaml output: " +
      buildYamlOutputPath(resolved.schemaDiffOutput),
  );
  console.log(
    "schema diff sql output: " +
      buildSchemaSqlOutputPath(resolved.schemaDiffOutput),
  );
  console.log("pg triggers output: " + resolved.pgTriggersOutput);
  console.log("pg triggers tables: " + resolved.pgTriggersTables.join(", "));
  if (
    expandedPgTriggersTables.join(",") !== resolved.pgTriggersTables.join(",")
  ) {
    console.log(
      "expanded pg triggers tables: " + expandedPgTriggersTables.join(", "),
    );
  }
  if (resolved.pgTriggersExcludeTables.length > 0) {
    console.log(
      "pg triggers exclude tables: " +
        resolved.pgTriggersExcludeTables.join(", "),
    );
  }
  if (
    expandedPgTriggersExcludeTables.join(",") !==
    resolved.pgTriggersExcludeTables.join(",")
  ) {
    console.log(
      "expanded pg triggers exclude tables: " +
        expandedPgTriggersExcludeTables.join(", "),
      );
  }
  console.log("pg views output: " + resolved.pgViewsOutput);
  console.log("pg views: " + resolved.pgViews.join(", "));
  if (expandedPgViews.join(",") !== resolved.pgViews.join(",")) {
    console.log("expanded pg views: " + expandedPgViews.join(", "));
  }
  if (resolved.pgViewsExclude.length > 0) {
    console.log("pg views exclude: " + resolved.pgViewsExclude.join(", "));
  }
  if (expandedPgViewsExclude.join(",") !== resolved.pgViewsExclude.join(",")) {
    console.log(
      "expanded pg views exclude: " + expandedPgViewsExclude.join(", "),
    );
  }
  console.log("include deletes: " + resolved.includeDeletes);
  console.log("pretty: " + resolved.pretty);
  console.log("generate sql: " + (resolved.generateSql ?? "interactive"));
  console.log(
    "generate pg triggers: " + (resolved.generatePgTriggers ?? "interactive"),
  );
  console.log(
    "generate pg views: " + (resolved.generatePgViews ?? "interactive"),
  );
}

function hasAnyGeneratorArgs(argv: string[]): boolean {
  const argKeys = [
    "--source-pg-host",
    "--source-pg-port",
    "--source-pg-database",
    "--source-pg-user",
    "--source-pg-password-env",
    "--source-pg-ssl",
    "--no-source-pg-ssl",
    "--dest-pg-host",
    "--dest-pg-port",
    "--dest-pg-database",
    "--dest-pg-user",
    "--dest-pg-password-env",
    "--dest-pg-ssl",
    "--no-dest-pg-ssl",
    "--schema",
    "--table",
    "--exclude-table",
    "--ignore-column",
    "--schema-diff-table",
    "--schema-diff-exclude-table",
    "--pg-triggers-table",
    "--pg-triggers-exclude-table",
    "--pg-view",
    "--pg-view-exclude",
    "--include-deletes",
    "--skip-missing-pk",
    "--output",
    "--schema-diff-output",
    "--pg-triggers-output",
    "--pg-views-output",
    "--pretty",
    "--generate-pg-triggers",
    "--no-generate-pg-triggers",
    "--generate-pg-views",
    "--no-generate-pg-views",
    "--verbose",
    "--config",
    "--wizard",
  ];
  return argv.some(
    (arg) =>
      argKeys.includes(arg) || argKeys.some((key) => arg.startsWith(`${key}=`)),
  );
}

function shouldAskInteractiveQuestion(skipPrompts: boolean): boolean {
  return !skipPrompts && process.stdin.isTTY === true;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return undefined;
}

main().catch((err) => {
  console.error("Fatal error:");
  logErrorDetails(err);
  process.exit(1);
});
