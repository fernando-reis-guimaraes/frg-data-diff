import { Pool } from "pg";
import { type DiffJson } from "../diff/diff-schema";
import { applyTableDiff, type ApplyTableOptions } from "./apply-diff";
import { createEmptySummary, type ApplySummary } from "../shared/summary";

export interface RunApplyOptions extends ApplyTableOptions {
  transaction: boolean;
}

/**
 * Applies a full diff to the destination database.
 * Handles transactions, conflict modes, and dry-run behavior.
 */
export async function runApply(
  destPool: Pool,
  diff: DiffJson,
  options: RunApplyOptions,
): Promise<ApplySummary> {
  const summary = createEmptySummary();
  const client = await destPool.connect();

  try {
    if (options.transaction && !options.dryRun) {
      await client.query("BEGIN");
    }

    try {
      for (const tableDiff of diff.tables) {
        await applyTableDiff(client, tableDiff, options, summary);
      }

      if (options.transaction && !options.dryRun) {
        await client.query("COMMIT");
      }
    } catch (err) {
      if (options.transaction && !options.dryRun) {
        await client.query("ROLLBACK");
      }
      throw err;
    }
  } finally {
    client.release();
  }

  return summary;
}
