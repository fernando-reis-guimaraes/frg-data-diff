#!/usr/bin/env node
/**
 * frg-data-diff apply
 *
 * Reads a JSON diff file and safely applies it to a destination PostgreSQL database.
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import {
  findConfigFile,
  loadConfig,
  DEFAULT_CONFIG_FILENAME,
} from "../config/load-config";
import {
  resolveApplyOptions,
  resolveRuntimeApplyOptions,
  type ResolvedApplyOptions,
  type RuntimeApplyOptions,
} from "../config/resolve-options";
import { createPool, resolveConnectionParams } from "../db/connection";
import { validateDiffJson } from "../diff/diff-schema";
import { runApply } from "../apply/plan";
import { printSummary } from "../shared/summary";
import { confirmProceed } from "../shared/prompts";
import { formatSecretValue, formatVisibleValue } from "../shared/env-values";

const program = new Command();

program
  .name("frg-data-diff apply")
  .description(
    "Reads a JSON diff file and safely applies it to a destination PostgreSQL database.",
  )
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
  .option("--input <file>", "Input diff file path", "frg-data-diff.json")
  .option(
    "--dry-run",
    "Simulate the apply without making any changes (default)",
  )
  .option(
    "--execute",
    "Apply changes to the destination database (required to mutate)",
  )
  .option("--apply-inserts", "Apply inserts (default: true)")
  .option("--no-apply-inserts", "Do not apply inserts")
  .option("--apply-updates", "Apply updates (default: true)")
  .option("--no-apply-updates", "Do not apply updates")
  .option(
    "--apply-deletes",
    "Apply deletes (default: false, requires explicit opt-in)",
  )
  .option("--no-apply-deletes", "Do not apply deletes (default)")
  .option(
    "--conflict-mode <mode>",
    "Conflict mode: abort, skip, or overwrite",
    "abort",
  )
  .option("--insert-mode <mode>", "Insert mode: strict or upsert", "strict")
  .option(
    "--transaction",
    "Wrap all changes in a single transaction (default: true)",
  )
  .option("--no-transaction", "Do not wrap changes in a transaction")
  .option("--verbose", "Enable verbose logging")
  .option("--config <file>", "Path to config file", DEFAULT_CONFIG_FILENAME)
  .option("--yes", "Skip interactive confirmation (for CI/CD)");

program.parse(process.argv);
const opts = program.opts();

async function main() {
  // Validate conflicting flags
  if (opts["dryRun"] && opts["execute"]) {
    console.error("Error: --dry-run and --execute cannot both be specified.");
    process.exit(1);
  }

  const configFilePath = path.resolve(
    opts["config"] || DEFAULT_CONFIG_FILENAME,
  );
  const configExists = fs.existsSync(configFilePath);

  let applyConfig: ReturnType<typeof loadConfig>["apply"] | undefined;

  if (configExists) {
    const config = loadConfig(configFilePath);
    applyConfig = config.apply;
  }

  // Determine dryRun: --execute overrides config/default dryRun
  const dryRunFromCli = resolveDryRunFromCli(opts["execute"], opts["dryRun"]);

  // Build resolved options from CLI args + config
  const cliArgs: Partial<ResolvedApplyOptions> = {
    destPgHost: opts["destPgHost"],
    destPgPort: opts["destPgPort"],
    destPgDatabase: opts["destPgDatabase"],
    destPgUser: opts["destPgUser"],
    destPgPassword: opts["destPgPasswordEnv"],
    destPgSsl: normalizeOptionalBoolean(opts["destPgSsl"]),
    input: opts["input"],
    dryRun: dryRunFromCli,
    applyInserts: normalizeOptionalBoolean(opts["applyInserts"]),
    applyUpdates: normalizeOptionalBoolean(opts["applyUpdates"]),
    applyDeletes: normalizeOptionalBoolean(opts["applyDeletes"]),
    conflictMode: opts["conflictMode"],
    insertMode: opts["insertMode"],
    transaction: normalizeOptionalBoolean(opts["transaction"]),
    verbose: opts["verbose"] ? true : undefined,
  };

  // Remove undefined values
  const cleanCliArgs = Object.fromEntries(
    Object.entries(cliArgs).filter(([, v]) => v !== undefined),
  ) as Partial<ResolvedApplyOptions>;

  const resolved = resolveApplyOptions(applyConfig, cleanCliArgs);
  const runtimeResolved = resolveRuntimeApplyOptions(resolved);

  // Validate required values
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

  if (!runtimeResolved.input) {
    console.error("Error: Missing required --input diff file path.");
    process.exit(1);
  }

  const inputPath = path.resolve(runtimeResolved.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Diff file not found: ${inputPath}`);
    process.exit(1);
  }

  // Validate conflict mode
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
      host: "destination host",
      port: "destination port",
      database: "destination database",
      user: "destination user",
      password: "destination password",
    },
  );

  // Print resolved plan
  printResolvedApplyPlan(resolved, runtimeResolved, inputPath, destConnection);

  // Ask for confirmation if no --yes flag
  if (!opts["yes"]) {
    const proceed = await confirmProceed();
    if (!proceed) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  // Load and validate the diff file
  let rawDiff: unknown;
  try {
    const content = fs.readFileSync(inputPath, "utf-8");
    rawDiff = JSON.parse(content);
  } catch (err) {
    console.error(`Error reading diff file: ${inputPath}`);
    if (err instanceof Error) console.error(err.message);
    process.exit(1);
  }

  let diff;
  try {
    diff = validateDiffJson(rawDiff);
  } catch (err) {
    console.error("Diff file validation failed:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (runtimeResolved.dryRun) {
    console.log(
      "\n[DRY RUN] No changes will be made to the destination database.",
    );
  } else {
    console.log("\nApplying changes to destination database...");
  }

  const destPool = createPool(destConnection);

  try {
    const summary = await runApply(destPool, diff, {
      dryRun: runtimeResolved.dryRun,
      applyInserts: runtimeResolved.applyInserts,
      applyUpdates: runtimeResolved.applyUpdates,
      applyDeletes: runtimeResolved.applyDeletes,
      conflictMode: runtimeResolved.conflictMode,
      insertMode: runtimeResolved.insertMode,
      transaction: runtimeResolved.transaction,
      verbose: resolved.verbose,
    });

    printSummary(summary, runtimeResolved.dryRun);

    // Output machine-readable summary
    console.log("\nMachine-readable summary:");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await destPool.end();
  }
}

function printResolvedApplyPlan(
  resolved: ResolvedApplyOptions,
  runtimeResolved: RuntimeApplyOptions,
  inputPath: string,
  destConnection?: {
    host: string;
    port: number;
    database: string;
    user: string;
  },
): void {
  const resolvedDest =
    destConnection ??
    resolveConnectionParams(
      {
        host: resolved.destPgHost,
        port: resolved.destPgPort,
        database: resolved.destPgDatabase,
        user: resolved.destPgUser,
        password: resolved.destPgPassword,
        ssl: runtimeResolved.destPgSsl,
      },
      {
        host: "destination host",
        port: "destination port",
        database: "destination database",
        user: "destination user",
        password: "destination password",
      },
    );
  console.log("\ntool:");
  console.log("  frg-data-diff apply");
  console.log("\ndest:");
  console.log(
    `  host: ${formatVisibleValue(resolved.destPgHost, resolvedDest.host)}`,
  );
  console.log(
    `  port: ${typeof resolved.destPgPort === "string" ? `${resolved.destPgPort} -> ${resolvedDest.port}` : resolvedDest.port}`,
  );
  console.log(
    `  database: ${formatVisibleValue(resolved.destPgDatabase, resolvedDest.database)}`,
  );
  console.log(
    `  user: ${formatVisibleValue(resolved.destPgUser, resolvedDest.user)}`,
  );
  console.log(
    `  password: ${formatSecretValue(String(resolved.destPgPassword))}`,
  );
  console.log(`  ssl: ${runtimeResolved.destPgSsl}`);
  console.log(`\ninput: ${inputPath}`);
  console.log(`dry-run: ${runtimeResolved.dryRun}`);
  console.log(`apply inserts: ${runtimeResolved.applyInserts}`);
  console.log(`apply updates: ${runtimeResolved.applyUpdates}`);
  console.log(`apply deletes: ${runtimeResolved.applyDeletes}`);
  console.log(`conflict mode: ${runtimeResolved.conflictMode}`);
  console.log(`insert mode: ${runtimeResolved.insertMode}`);
  console.log(`transaction: ${runtimeResolved.transaction}`);

  if (runtimeResolved.applyDeletes) {
    console.log(
      "\nWarning: applyDeletes is enabled. Rows may be deleted from the destination database.",
    );
  }
}

main().catch((err) => {
  console.error(
    "Fatal error:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return undefined;
}

function resolveDryRunFromCli(
  execute: unknown,
  dryRun: unknown,
): boolean | undefined {
  if (execute === true) {
    return false;
  }
  if (dryRun === true) {
    return true;
  }
  return undefined;
}
