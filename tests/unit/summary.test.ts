import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createEmptySummary,
  printSummary,
  type ApplySummary,
} from "../../src/shared/summary";

describe("createEmptySummary", () => {
  it("creates an empty summary with zero counts", () => {
    const summary = createEmptySummary();
    expect(summary.applied.inserts).toBe(0);
    expect(summary.applied.updates).toBe(0);
    expect(summary.applied.deletes).toBe(0);
    expect(summary.skipped).toEqual([]);
    expect(summary.conflicts).toEqual([]);
  });
});

describe("printSummary", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("prints summary with correct counts", () => {
    const summary: ApplySummary = {
      applied: { inserts: 3, updates: 2, deletes: 1 },
      skipped: [],
      conflicts: [],
    };
    printSummary(summary, false);
    const calls = consoleSpy.mock.calls.map((c) => c[0]) as string[];
    expect(calls.some((c: string) => c.includes("Inserts applied: 3"))).toBe(
      true,
    );
    expect(calls.some((c: string) => c.includes("Updates applied: 2"))).toBe(
      true,
    );
    expect(calls.some((c: string) => c.includes("Deletes applied: 1"))).toBe(
      true,
    );
  });

  it("prefixes output with [DRY RUN] when dryRun is true", () => {
    const summary = createEmptySummary();
    printSummary(summary, true);
    const firstCall = consoleSpy.mock.calls[0][0] as string;
    expect(firstCall).toContain("[DRY RUN]");
  });

  it("does not prefix with [DRY RUN] when dryRun is false", () => {
    const summary = createEmptySummary();
    printSummary(summary, false);
    const firstCall = consoleSpy.mock.calls[0][0] as string;
    expect(firstCall).not.toContain("[DRY RUN]");
  });

  it("prints skipped rows when present", () => {
    const summary: ApplySummary = {
      applied: { inserts: 0, updates: 0, deletes: 0 },
      skipped: [
        {
          table: "my_table",
          operation: "update",
          pk: { id: 1 },
          reason: "guard failed",
        },
      ],
      conflicts: [],
    };
    printSummary(summary, false);
    const calls = consoleSpy.mock.calls.map((c) => c[0]) as string[];
    expect(calls.some((c: string) => c.includes("Skipped rows: 1"))).toBe(true);
  });
});
