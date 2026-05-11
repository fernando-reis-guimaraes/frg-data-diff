/**
 * Summary of apply results.
 */
export interface ApplySummary {
  applied: {
    inserts: number;
    updates: number;
    deletes: number;
  };
  skipped: SkippedRow[];
  conflicts: ConflictRow[];
}

export interface SkippedRow {
  table: string;
  operation: "insert" | "update" | "delete";
  pk: Record<string, unknown>;
  reason: string;
}

export interface ConflictRow {
  table: string;
  operation: "insert" | "update" | "delete";
  pk: Record<string, unknown>;
  reason: string;
}

/**
 * Creates an empty summary object.
 */
export function createEmptySummary(): ApplySummary {
  return {
    applied: {
      inserts: 0,
      updates: 0,
      deletes: 0,
    },
    skipped: [],
    conflicts: [],
  };
}

/**
 * Prints a human-readable summary to stdout.
 */
export function printSummary(summary: ApplySummary, dryRun: boolean): void {
  const prefix = dryRun ? "[DRY RUN] " : "";
  console.log(`\n${prefix}Apply summary:`);
  console.log(`  Inserts applied: ${summary.applied.inserts}`);
  console.log(`  Updates applied: ${summary.applied.updates}`);
  console.log(`  Deletes applied: ${summary.applied.deletes}`);

  if (summary.skipped.length > 0) {
    console.log(`  Skipped rows: ${summary.skipped.length}`);
    for (const s of summary.skipped) {
      console.log(
        `    - ${s.table} [${s.operation}] pk=${JSON.stringify(s.pk)}: ${s.reason}`,
      );
    }
  }

  if (summary.conflicts.length > 0) {
    console.log(`  Conflicts: ${summary.conflicts.length}`);
    for (const c of summary.conflicts) {
      console.log(
        `    - ${c.table} [${c.operation}] pk=${JSON.stringify(c.pk)}: ${c.reason}`,
      );
    }
  }
}
