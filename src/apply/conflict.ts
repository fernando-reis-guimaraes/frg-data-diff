/**
 * Conflict handling documentation and utilities.
 *
 * Conflict modes:
 *
 * abort   - (default) Abort the transaction on the first conflict.
 *            The destination database is left unchanged (if transaction=true).
 *
 * skip    - Skip the conflicting row and continue applying other rows.
 *           Skipped rows are recorded in the summary.
 *
 * overwrite - Ignore the "from" guard for updates and force the "to" value.
 *             For inserts, behaves like upsert.
 *             Note: overwrite does NOT disable guarded deletes.
 *             Deletes still check the guard even in overwrite mode
 *             to prevent accidental data loss.
 */
export type ConflictMode = "abort" | "skip" | "overwrite";

export function describeConflictMode(mode: ConflictMode): string {
  switch (mode) {
    case "abort":
      return "abort: Roll back transaction on first conflict (default, safest)";
    case "skip":
      return "skip: Skip conflicting rows and continue";
    case "overwrite":
      return "overwrite: Force apply changes, ignoring from-value guards for updates";
  }
}
