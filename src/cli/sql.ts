#!/usr/bin/env node
/**
 * frg-data-diff sql
 *
 * Reads a JSON diff file and writes a plain SQL script that can be reviewed
 * and executed manually.
 */

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { loadConfig, DEFAULT_CONFIG_FILENAME } from "../config/load-config";
import {
  resolveApplyOptions,
  resolveRuntimeApplyOptions,
} from "../config/resolve-options";
import { validateDiffJson } from "../diff/diff-schema";
import { buildSqlOutputPath, generateSqlScript } from "../sql/generate-sql";
import { confirmProceed } from "../shared/prompts";

const program = new Command();

program
  .name("frg-data-diff sql")
  .description(
    "Reads a JSON diff file and writes a SQL script for manual execution.",
  )
  .option("--input <file>", "Input diff file path")
  .option("--output <file>", "Output SQL file path")
  .option("--apply-inserts", "Include inserts in the SQL output")
  .option("--no-apply-inserts", "Do not include inserts in the SQL output")
  .option("--apply-updates", "Include updates in the SQL output")
  .option("--no-apply-updates", "Do not include updates in the SQL output")
  .option("--apply-deletes", "Include deletes in the SQL output")
  .option("--no-apply-deletes", "Do not include deletes in the SQL output")
  .option("--transaction", "Wrap the SQL in BEGIN/COMMIT")
  .option("--no-transaction", "Do not wrap the SQL in BEGIN/COMMIT")
  .option("--config <file>", "Path to config file", DEFAULT_CONFIG_FILENAME)
  .option("--yes", "Skip interactive confirmation");

program.parse(process.argv);
const opts = program.opts();

async function main() {
  const configFilePath = path.resolve(
    opts["config"] || DEFAULT_CONFIG_FILENAME,
  );
  const configExists = fs.existsSync(configFilePath);
  const config = configExists ? loadConfig(configFilePath) : undefined;

  const rawApplyOptions = resolveApplyOptions(config?.apply, {
    input: opts["input"],
    applyInserts: normalizeOptionalBoolean(opts["applyInserts"]),
    applyUpdates: normalizeOptionalBoolean(opts["applyUpdates"]),
    applyDeletes: normalizeOptionalBoolean(opts["applyDeletes"]),
    transaction: normalizeOptionalBoolean(opts["transaction"]),
  });
  const runtimeApplyOptions = resolveRuntimeApplyOptions(rawApplyOptions);

  const input = runtimeApplyOptions.input;
  const output = opts["output"]
    ? path.resolve(opts["output"])
    : path.resolve(buildSqlOutputPath(input));
  const applyInserts = runtimeApplyOptions.applyInserts;
  const applyUpdates = runtimeApplyOptions.applyUpdates;
  const applyDeletes = runtimeApplyOptions.applyDeletes;
  const transaction = runtimeApplyOptions.transaction;

  const inputPath = path.resolve(input);
  const outputPath = output;

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Diff file not found: ${inputPath}`);
    process.exit(1);
  }

  printResolvedPlan({
    inputPath,
    outputPath,
    applyInserts,
    applyUpdates,
    applyDeletes,
    transaction,
  });

  if (!opts["yes"]) {
    const proceed = await confirmProceed();
    if (!proceed) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  let rawDiff: unknown;
  try {
    rawDiff = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
  } catch (err) {
    console.error(`Error reading diff file: ${inputPath}`);
    if (err instanceof Error) console.error(err.message);
    process.exit(1);
  }

  const diff = validateDiffJson(rawDiff);
  const result = generateSqlScript(diff, {
    applyInserts,
    applyUpdates,
    applyDeletes,
    transaction,
  });

  fs.writeFileSync(outputPath, result.sql, "utf-8");

  console.log(`\nSQL written to: ${outputPath}`);
  console.log("\nSummary:");
  console.log(`  Inserts: ${result.summary.inserts}`);
  console.log(`  Updates: ${result.summary.updates}`);
  console.log(`  Deletes: ${result.summary.deletes}`);
  console.log("\nReview the SQL carefully before executing it.");
}
function printResolvedPlan(args: {
  inputPath: string;
  outputPath: string;
  applyInserts: boolean;
  applyUpdates: boolean;
  applyDeletes: boolean;
  transaction: boolean;
}): void {
  console.log("\ntool:");
  console.log("  frg-data-diff sql");
  console.log(`\ninput: ${args.inputPath}`);
  console.log(`output: ${args.outputPath}`);
  console.log(`apply inserts: ${args.applyInserts}`);
  console.log(`apply updates: ${args.applyUpdates}`);
  console.log(`apply deletes: ${args.applyDeletes}`);
  console.log(`transaction: ${args.transaction}`);
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
