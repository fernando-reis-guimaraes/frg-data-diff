/**
 * Integration tests for the generator and apply tools.
 *
 * Prerequisites: docker-compose up must be running with pg_source and pg_dest.
 * Set these env vars:
 *   PG_SOURCE_HOST, PG_SOURCE_PORT, PG_SOURCE_DB, PG_SOURCE_USER, PG_SOURCE_PASSWORD
 *   PG_DEST_HOST, PG_DEST_PORT, PG_DEST_DB, PG_DEST_USER, PG_DEST_PASSWORD
 *
 * Or use the defaults (localhost:15432 and localhost:15433).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  createSourcePool,
  createDestPool,
  setupTestSchema,
  insertBaselineRows,
  mutateSourceRows,
} from "./helpers";
import { generateDiff } from "../../src/diff/generate-diff";
import { runApply } from "../../src/apply/plan";
import { createEmptySummary } from "../../src/shared/summary";
import {
  resolveGeneratorOptions,
  resolveRuntimeGeneratorOptions,
} from "../../src/config/resolve-options";
import { generateSqlScript } from "../../src/sql/generate-sql";
import { generateSchemaDiff } from "../../src/schema-diff/generate-schema-diff";
import { generateSchemaSqlScript } from "../../src/schema-diff/generate-schema-sql";

const TABLES = ["type_test_table", "composite_pk_table"];
const SCHEMA = "public";
const IGNORE_COLUMNS: string[] = [];

let sourcePool: ReturnType<typeof createSourcePool>;
let destPool: ReturnType<typeof createDestPool>;
let tmpDir: string;

beforeAll(async () => {
  sourcePool = createSourcePool();
  destPool = createDestPool();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frg-integration-"));

  // Set up identical schema in both databases
  await setupTestSchema(sourcePool);
  await setupTestSchema(destPool);

  // Seed both with identical baseline data
  await insertBaselineRows(sourcePool);
  await insertBaselineRows(destPool);

  // Mutate source (makes source and dest diverge)
  await mutateSourceRows(sourcePool);
  // Also delete row 3 from source (it exists only in dest now -> delete candidate)
  const srcClient = await sourcePool.connect();
  try {
    await srcClient.query("DELETE FROM type_test_table WHERE id = 3");
  } finally {
    srcClient.release();
  }
}, 60000);

afterAll(async () => {
  await sourcePool.end();
  await destPool.end();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateDiff", () => {
  it("detects an update, an insert, and a delete", async () => {
    const diff = await generateDiff(sourcePool, destPool, {
      schema: SCHEMA,
      tables: ["type_test_table"],
      excludeTables: [],
      ignoreColumns: IGNORE_COLUMNS,
      includeDeletes: true,
      skipMissingPk: false,
      verbose: false,
    });

    expect(diff.format).toBe("postgres-data-diff-json/v1");
    const tableDiff = diff.tables.find((t) => t.table === "type_test_table");
    expect(tableDiff).toBeDefined();

    // Row 1 was updated in source
    expect(tableDiff!.updates.length).toBeGreaterThanOrEqual(1);
    const row1Update = tableDiff!.updates.find((u) => u.pk["id"] === 1);
    expect(row1Update).toBeDefined();
    expect(row1Update!.changes["text_val"]).toBeDefined();
    expect(row1Update!.changes["text_val"].from).toBe("hello");
    expect(row1Update!.changes["text_val"].to).toBe("updated hello");
    expect(row1Update!.guard).toBeDefined();
    expect(row1Update!.guard!["id"]).toBe(1);
    expect(row1Update!.guard!["varchar_val"]).toBe("world");

    // Row 4 was inserted in source
    expect(tableDiff!.inserts.length).toBeGreaterThanOrEqual(1);
    const row4Insert = tableDiff!.inserts.find((i) => i.row["id"] === 4);
    expect(row4Insert).toBeDefined();

    // Row 3 was deleted from source (only in dest)
    expect(tableDiff!.deletes.length).toBeGreaterThanOrEqual(1);
    const row3Delete = tableDiff!.deletes.find((d) => d.pk["id"] === 3);
    expect(row3Delete).toBeDefined();
    // Guard should contain the full row
    expect(row3Delete!.guard["id"]).toBe(3);
  });

  it("detects composite PK update", async () => {
    const diff = await generateDiff(sourcePool, destPool, {
      schema: SCHEMA,
      tables: ["composite_pk_table"],
      excludeTables: [],
      ignoreColumns: [],
      includeDeletes: false,
      skipMissingPk: false,
      verbose: false,
    });

    const tableDiff = diff.tables.find((t) => t.table === "composite_pk_table");
    expect(tableDiff).toBeDefined();
    expect(tableDiff!.primaryKey).toEqual(["tenant_id", "item_id"]);

    const update = tableDiff!.updates.find(
      (u) => u.pk["tenant_id"] === 1 && u.pk["item_id"] === 1,
    );
    expect(update).toBeDefined();
    expect(update!.changes["name"].from).toBe("tenant1-item1");
    expect(update!.changes["name"].to).toBe("UPDATED");
    expect(update!.guard).toBeDefined();
    expect(update!.guard!["value"]).toBe("value-a");
  });

  it("skips deletes when includeDeletes is false", async () => {
    const diff = await generateDiff(sourcePool, destPool, {
      schema: SCHEMA,
      tables: ["type_test_table"],
      excludeTables: [],
      ignoreColumns: [],
      includeDeletes: false,
      skipMissingPk: false,
      verbose: false,
    });

    const tableDiff = diff.tables.find((t) => t.table === "type_test_table");
    expect(tableDiff!.deletes.length).toBe(0);
  });

  it("ignores listed columns", async () => {
    // Mutate dest row 2 in a column that should be ignored
    const dstClient = await destPool.connect();
    try {
      await dstClient.query(
        `UPDATE type_test_table SET varchar_val = 'IGNORED' WHERE id = 2`,
      );
    } finally {
      dstClient.release();
    }

    const diff = await generateDiff(sourcePool, destPool, {
      schema: SCHEMA,
      tables: ["type_test_table"],
      excludeTables: [],
      ignoreColumns: ["varchar_val"],
      includeDeletes: false,
      skipMissingPk: false,
      verbose: false,
    });

    const tableDiff = diff.tables.find((t) => t.table === "type_test_table");
    const row2Update = tableDiff!.updates.find((u) => u.pk["id"] === 2);
    // varchar_val was ignored, no update for row 2 due to varchar_val
    if (row2Update) {
      expect(row2Update.changes["varchar_val"]).toBeUndefined();
    }
  });

  it("does not generate a diff for generated columns", async () => {
    const diff = await generateDiff(sourcePool, destPool, {
      schema: SCHEMA,
      tables: ["type_test_table"],
      excludeTables: [],
      ignoreColumns: [],
      includeDeletes: false,
      skipMissingPk: false,
      verbose: false,
    });

    const tableDiff = diff.tables.find((t) => t.table === "type_test_table");
    // Check that no update mentions generated_col
    for (const update of tableDiff!.updates) {
      expect(update.changes["generated_col"]).toBeUndefined();
    }
  });

  it("fails on table without primary key by default", async () => {
    await expect(
      generateDiff(sourcePool, destPool, {
        schema: SCHEMA,
        tables: ["no_pk_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: false,
        skipMissingPk: false,
        verbose: false,
      }),
    ).rejects.toThrow(/no primary key/i);
  });

  it("skips table without primary key when skipMissingPk is true", async () => {
    const diff = await generateDiff(sourcePool, destPool, {
      schema: SCHEMA,
      tables: ["no_pk_table"],
      excludeTables: [],
      ignoreColumns: [],
      includeDeletes: false,
      skipMissingPk: true,
      verbose: false,
    });

    expect(diff.summary.skippedTables).toContain("no_pk_table");
  });

  it("omits tables that have no inserts, updates, or deletes", async () => {
    const pristineSourcePool = createSourcePool();
    const pristineDestPool = createDestPool();

    try {
      await setupTestSchema(pristineSourcePool);
      await setupTestSchema(pristineDestPool);
      await insertBaselineRows(pristineSourcePool);
      await insertBaselineRows(pristineDestPool);

      const diff = await generateDiff(pristineSourcePool, pristineDestPool, {
        schema: SCHEMA,
        tables: ["type_test_table", "composite_pk_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: true,
        skipMissingPk: false,
        verbose: false,
      });

      expect(diff.tables).toEqual([]);
      expect(diff.summary.tablesCompared).toBe(2);
      expect(diff.summary.inserts).toBe(0);
      expect(diff.summary.updates).toBe(0);
      expect(diff.summary.deletes).toBe(0);
    } finally {
      await pristineSourcePool.end();
      await pristineDestPool.end();
      await setupTestSchema(sourcePool);
      await setupTestSchema(destPool);
      await insertBaselineRows(sourcePool);
      await insertBaselineRows(destPool);
      await mutateSourceRows(sourcePool);
      const srcClient = await sourcePool.connect();
      try {
        await srcClient.query("DELETE FROM type_test_table WHERE id = 3");
      } finally {
        srcClient.release();
      }
    }
  });

  it("expands env-backed table filters before generating the diff", async () => {
    process.env.TEST_DIFF_TABLES = "type_test_table";
    process.env.TEST_EXCLUDE_TABLES = "composite_pk_table";
    process.env.TEST_IGNORE_COLUMNS = "varchar_val";

    try {
      const merged = resolveGeneratorOptions(undefined, {
        sourcePgHost: "unused",
        sourcePgDatabase: "unused",
        sourcePgUser: "unused",
        sourcePgPassword: "unused",
        sourcePgSsl: false,
        destPgHost: "unused",
        destPgDatabase: "unused",
        destPgUser: "unused",
        destPgPassword: "unused",
        destPgSsl: false,
        schema: SCHEMA,
        tables: ["$TEST_DIFF_TABLES"],
        excludeTables: ["$TEST_EXCLUDE_TABLES"],
        ignoreColumns: ["$TEST_IGNORE_COLUMNS"],
      });

      expect(merged.tables).toEqual(["$TEST_DIFF_TABLES"]);
      expect(merged.excludeTables).toEqual(["$TEST_EXCLUDE_TABLES"]);
      expect(merged.ignoreColumns).toEqual(["$TEST_IGNORE_COLUMNS"]);

      const resolved = resolveRuntimeGeneratorOptions(merged);
      expect(resolved.tables).toEqual(["type_test_table"]);
      expect(resolved.excludeTables).toEqual(["composite_pk_table"]);
      expect(resolved.ignoreColumns).toEqual(["varchar_val"]);

      const diff = await generateDiff(sourcePool, destPool, {
        schema: resolved.schema,
        tables: resolved.tables,
        excludeTables: resolved.excludeTables,
        ignoreColumns: resolved.ignoreColumns,
        includeDeletes: false,
        skipMissingPk: false,
        verbose: false,
      });

      expect(diff.tables.map((table) => table.table)).toEqual([
        "type_test_table",
      ]);
      const tableDiff = diff.tables[0];
      expect(tableDiff).toBeDefined();
      const row1Update = tableDiff.updates.find(
        (update) => update.pk["id"] === 1,
      );
      expect(row1Update).toBeDefined();
      expect(row1Update!.changes["varchar_val"]).toBeUndefined();
    } finally {
      delete process.env.TEST_DIFF_TABLES;
      delete process.env.TEST_EXCLUDE_TABLES;
      delete process.env.TEST_IGNORE_COLUMNS;
    }
  });

  it("applies tablesWhereDataFilters equally to source and destination row reads", async () => {
    const sourceClient = await sourcePool.connect();
    const destClient = await destPool.connect();

    try {
      await sourceClient.query("DROP TABLE IF EXISTS directus_presets");
      await destClient.query("DROP TABLE IF EXISTS directus_presets");
      await sourceClient.query(`
        CREATE TABLE directus_presets (
          id integer PRIMARY KEY,
          "user" integer,
          bookmark text
        )
      `);
      await destClient.query(`
        CREATE TABLE directus_presets (
          id integer PRIMARY KEY,
          "user" integer,
          bookmark text
        )
      `);

      await sourceClient.query(`
        INSERT INTO directus_presets (id, "user", bookmark)
        VALUES
          (1, NULL, 'global-source'),
          (3, 20, 'personal-source')
      `);
      await destClient.query(`
        INSERT INTO directus_presets (id, "user", bookmark)
        VALUES
          (1, NULL, 'global-dest'),
          (2, 10, 'personal-target')
      `);

      const unfilteredDiff = await generateDiff(sourcePool, destPool, {
        schema: SCHEMA,
        tables: ["directus_presets"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: true,
        skipMissingPk: false,
        verbose: false,
      });
      const unfilteredTable = unfilteredDiff.tables.find(
        (table) => table.table === "directus_presets",
      );
      expect(unfilteredTable?.updates.map((update) => update.pk["id"])).toEqual(
        [1],
      );
      expect(
        unfilteredTable?.inserts.map((insert) => insert.row["id"]),
      ).toEqual([3]);
      expect(unfilteredTable?.deletes.map((del) => del.pk["id"])).toEqual([2]);

      const filteredDiff = await generateDiff(sourcePool, destPool, {
        schema: SCHEMA,
        tables: ["directus_presets"],
        excludeTables: [],
        ignoreColumns: [],
        tablesWhereDataFilters: {
          directus_presets: '"user" IS NULL',
        },
        includeDeletes: true,
        skipMissingPk: false,
        verbose: false,
      });
      const filteredTable = filteredDiff.tables.find(
        (table) => table.table === "directus_presets",
      );

      expect(filteredTable).toBeDefined();
      expect(filteredTable!.updates.map((update) => update.pk["id"])).toEqual([
        1,
      ]);
      expect(filteredTable!.updates[0].changes["bookmark"]).toEqual({
        from: "global-dest",
        to: "global-source",
      });
      expect(filteredTable!.inserts).toEqual([]);
      expect(filteredTable!.deletes).toEqual([]);

      const sqlResult = generateSqlScript(filteredDiff, {
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: true,
        transaction: true,
      });
      expect(sqlResult.sql).toContain("UPDATE");
      expect(sqlResult.sql).not.toContain("personal-source");
      expect(sqlResult.sql).not.toContain("personal-target");
      expect(sqlResult.sql).not.toContain("INSERT INTO");
      expect(sqlResult.sql).not.toContain("DELETE FROM");
    } finally {
      await sourceClient.query("DROP TABLE IF EXISTS directus_presets");
      await destClient.query("DROP TABLE IF EXISTS directus_presets");
      sourceClient.release();
      destClient.release();
    }
  });
});

describe("runApply", () => {
  let freshDestPool: ReturnType<typeof createDestPool>;

  beforeAll(async () => {
    freshDestPool = createDestPool();
  });

  afterAll(async () => {
    await freshDestPool.end();
  });

  it("dry-run does not mutate destination", async () => {
    const diff = await generateDiff(sourcePool, destPool, {
      schema: SCHEMA,
      tables: ["type_test_table"],
      excludeTables: [],
      ignoreColumns: [],
      includeDeletes: true,
      skipMissingPk: false,
      verbose: false,
    });

    // Get current state of dest before dry-run
    const destClient = await destPool.connect();
    let rowsBefore: Array<Record<string, unknown>>;
    try {
      const result = await destClient.query(
        "SELECT id, text_val FROM type_test_table ORDER BY id",
      );
      rowsBefore = result.rows;
    } finally {
      destClient.release();
    }

    // Run dry-run apply
    await runApply(destPool, diff, {
      dryRun: true,
      applyInserts: true,
      applyUpdates: true,
      applyDeletes: true,
      conflictMode: "abort",
      insertMode: "strict",
      transaction: true,
      verbose: false,
    });

    // Verify dest is unchanged
    const destClient2 = await destPool.connect();
    let rowsAfter: Array<Record<string, unknown>>;
    try {
      const result = await destClient2.query(
        "SELECT id, text_val FROM type_test_table ORDER BY id",
      );
      rowsAfter = result.rows;
    } finally {
      destClient2.release();
    }

    expect(rowsAfter).toEqual(rowsBefore);
  });

  it("applies inserts and updates to destination", async () => {
    // Set up a fresh dest for this test
    await setupTestSchema(freshDestPool);
    await insertBaselineRows(freshDestPool);
    // Note: row 3 still in freshDest, and row 1 is old, and row 4 is missing

    const diff = await generateDiff(sourcePool, freshDestPool, {
      schema: SCHEMA,
      tables: ["type_test_table"],
      excludeTables: [],
      ignoreColumns: [],
      includeDeletes: false,
      skipMissingPk: false,
      verbose: false,
    });

    expect(diff.summary.inserts).toBeGreaterThanOrEqual(1); // row 4
    expect(diff.summary.updates).toBeGreaterThanOrEqual(1); // row 1

    const summary = await runApply(freshDestPool, diff, {
      dryRun: false,
      applyInserts: true,
      applyUpdates: true,
      applyDeletes: false,
      conflictMode: "abort",
      insertMode: "strict",
      transaction: true,
      verbose: false,
    });

    expect(summary.applied.inserts).toBeGreaterThanOrEqual(1);
    expect(summary.applied.updates).toBeGreaterThanOrEqual(1);

    // Verify row 1 was updated
    const client = await freshDestPool.connect();
    try {
      const result = await client.query(
        "SELECT text_val FROM type_test_table WHERE id = 1",
      );
      expect(result.rows[0].text_val).toBe("updated hello");

      // Verify row 4 was inserted
      const result4 = await client.query(
        "SELECT text_val FROM type_test_table WHERE id = 4",
      );
      expect(result4.rows.length).toBe(1);
      expect(result4.rows[0].text_val).toBe("new row");
    } finally {
      client.release();
    }
  });

  it("applyDeletes false: does not delete rows even if diff contains deletes", async () => {
    const freshPool = createDestPool();
    try {
      await setupTestSchema(freshPool);
      await insertBaselineRows(freshPool);

      const diff = await generateDiff(sourcePool, freshPool, {
        schema: SCHEMA,
        tables: ["type_test_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: true,
        skipMissingPk: false,
        verbose: false,
      });

      // Diff should have deletes
      const tableDiff = diff.tables.find((t) => t.table === "type_test_table");
      expect(tableDiff!.deletes.length).toBeGreaterThan(0);

      await runApply(freshPool, diff, {
        dryRun: false,
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: false, // deletes disabled
        conflictMode: "abort",
        insertMode: "strict",
        transaction: true,
        verbose: false,
      });

      // Row 3 should still be in freshPool (not deleted)
      const client = await freshPool.connect();
      try {
        const result = await client.query(
          "SELECT id FROM type_test_table WHERE id = 3",
        );
        expect(result.rows.length).toBe(1);
      } finally {
        client.release();
      }
    } finally {
      await freshPool.end();
    }
  });

  it("applies deletes when applyDeletes is true", async () => {
    const freshPool = createDestPool();
    try {
      await setupTestSchema(freshPool);
      await insertBaselineRows(freshPool);

      const diff = await generateDiff(sourcePool, freshPool, {
        schema: SCHEMA,
        tables: ["type_test_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: true,
        skipMissingPk: false,
        verbose: false,
      });

      const summary = await runApply(freshPool, diff, {
        dryRun: false,
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: true,
        conflictMode: "abort",
        insertMode: "strict",
        transaction: true,
        verbose: false,
      });

      expect(summary.applied.deletes).toBeGreaterThanOrEqual(1);

      // Row 3 should be gone
      const client = await freshPool.connect();
      try {
        const result = await client.query(
          "SELECT id FROM type_test_table WHERE id = 3",
        );
        expect(result.rows.length).toBe(0);
      } finally {
        client.release();
      }
    } finally {
      await freshPool.end();
    }
  });

  it("guarded delete: does not delete if dest row changed after diff was generated", async () => {
    const freshPool = createDestPool();
    try {
      await setupTestSchema(freshPool);
      await insertBaselineRows(freshPool);

      // Generate diff with deletes
      const diff = await generateDiff(sourcePool, freshPool, {
        schema: SCHEMA,
        tables: ["type_test_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: true,
        skipMissingPk: false,
        verbose: false,
      });

      // Now mutate the delete candidate in dest (row 3) to break the guard
      const client = await freshPool.connect();
      try {
        await client.query(
          `UPDATE type_test_table SET text_val = 'CHANGED IN PROD' WHERE id = 3`,
        );
      } finally {
        client.release();
      }

      // Apply with skip mode - should skip the guarded delete
      const summary = await runApply(freshPool, diff, {
        dryRun: false,
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: true,
        conflictMode: "skip",
        insertMode: "strict",
        transaction: true,
        verbose: false,
      });

      // Row 3 was guarded and should not be deleted
      const verifyClient = await freshPool.connect();
      try {
        const result = await verifyClient.query(
          "SELECT id FROM type_test_table WHERE id = 3",
        );
        expect(result.rows.length).toBe(1); // Not deleted
      } finally {
        verifyClient.release();
      }
    } finally {
      await freshPool.end();
    }
  });

  it("conflict mode abort: rolls back transaction on conflict", async () => {
    const freshPool = createDestPool();
    try {
      await setupTestSchema(freshPool);
      await insertBaselineRows(freshPool);

      // Generate diff
      const diff = await generateDiff(sourcePool, freshPool, {
        schema: SCHEMA,
        tables: ["type_test_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: false,
        skipMissingPk: false,
        verbose: false,
      });

      // Mutate dest row 1 differently so guard check will fail
      const client = await freshPool.connect();
      try {
        await client.query(
          `UPDATE type_test_table SET text_val = 'CONFLICTING CHANGE' WHERE id = 1`,
        );
      } finally {
        client.release();
      }

      // Apply should throw (abort mode) due to guard conflict on update
      await expect(
        runApply(freshPool, diff, {
          dryRun: false,
          applyInserts: false,
          applyUpdates: true,
          applyDeletes: false,
          conflictMode: "abort",
          insertMode: "strict",
          transaction: true,
          verbose: false,
        }),
      ).rejects.toThrow();

      // Verify transaction was rolled back - original conflicting change should still be there
      const verifyClient = await freshPool.connect();
      try {
        const result = await verifyClient.query(
          "SELECT text_val FROM type_test_table WHERE id = 1",
        );
        expect(result.rows[0].text_val).toBe("CONFLICTING CHANGE");
      } finally {
        verifyClient.release();
      }
    } finally {
      await freshPool.end();
    }
  });

  it("conflict mode skip: skips conflicting row and continues", async () => {
    const freshPool = createDestPool();
    try {
      await setupTestSchema(freshPool);
      await insertBaselineRows(freshPool);

      const diff = await generateDiff(sourcePool, freshPool, {
        schema: SCHEMA,
        tables: ["type_test_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: false,
        skipMissingPk: false,
        verbose: false,
      });

      // Mutate dest to cause conflict
      const client = await freshPool.connect();
      try {
        await client.query(
          `UPDATE type_test_table SET text_val = 'CONFLICTING' WHERE id = 1`,
        );
      } finally {
        client.release();
      }

      // Apply in skip mode - should skip row 1 update but still apply row 4 insert
      const summary = await runApply(freshPool, diff, {
        dryRun: false,
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: false,
        conflictMode: "skip",
        insertMode: "strict",
        transaction: true,
        verbose: false,
      });

      // Row 1 update was skipped (guard failed), row 4 insert should succeed
      expect(summary.skipped.length).toBeGreaterThanOrEqual(1);

      // Row 4 should still be inserted
      const verifyClient = await freshPool.connect();
      try {
        const result = await verifyClient.query(
          "SELECT id FROM type_test_table WHERE id = 4",
        );
        expect(result.rows.length).toBe(1);
      } finally {
        verifyClient.release();
      }
    } finally {
      await freshPool.end();
    }
  });

  it("update guard blocks apply when an unrelated destination column changed", async () => {
    const freshPool = createDestPool();
    try {
      await setupTestSchema(freshPool);
      await insertBaselineRows(freshPool);

      const diff = await generateDiff(sourcePool, freshPool, {
        schema: SCHEMA,
        tables: ["type_test_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: false,
        skipMissingPk: false,
        verbose: false,
      });

      const client = await freshPool.connect();
      try {
        await client.query(
          `UPDATE type_test_table SET varchar_val = 'UNRELATED CHANGE' WHERE id = 1`,
        );
      } finally {
        client.release();
      }

      const summary = await runApply(freshPool, diff, {
        dryRun: false,
        applyInserts: false,
        applyUpdates: true,
        applyDeletes: false,
        conflictMode: "skip",
        insertMode: "strict",
        transaction: true,
        verbose: false,
      });

      expect(
        summary.skipped.some(
          (row) => row.operation === "update" && row.pk["id"] === 1,
        ),
      ).toBe(true);

      const verifyClient = await freshPool.connect();
      try {
        const result = await verifyClient.query(
          "SELECT text_val, varchar_val FROM type_test_table WHERE id = 1",
        );
        expect(result.rows[0].text_val).toBe("hello");
        expect(result.rows[0].varchar_val).toBe("UNRELATED CHANGE");
      } finally {
        verifyClient.release();
      }
    } finally {
      await freshPool.end();
    }
  });

  it("conflict mode overwrite: forces apply regardless of from-value guard", async () => {
    const freshPool = createDestPool();
    try {
      await setupTestSchema(freshPool);
      await insertBaselineRows(freshPool);

      const diff = await generateDiff(sourcePool, freshPool, {
        schema: SCHEMA,
        tables: ["type_test_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: false,
        skipMissingPk: false,
        verbose: false,
      });

      // Mutate dest to cause conflict
      const client = await freshPool.connect();
      try {
        await client.query(
          `UPDATE type_test_table SET text_val = 'CONFLICTING' WHERE id = 1`,
        );
      } finally {
        client.release();
      }

      // Apply in overwrite mode - should force the update
      const summary = await runApply(freshPool, diff, {
        dryRun: false,
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: false,
        conflictMode: "overwrite",
        insertMode: "strict",
        transaction: true,
        verbose: false,
      });

      // Row 1 update should succeed
      expect(summary.applied.updates).toBeGreaterThanOrEqual(1);

      const verifyClient = await freshPool.connect();
      try {
        const result = await verifyClient.query(
          "SELECT text_val FROM type_test_table WHERE id = 1",
        );
        expect(result.rows[0].text_val).toBe("updated hello");
      } finally {
        verifyClient.release();
      }
    } finally {
      await freshPool.end();
    }
  });

  it("upsert mode inserts if PK exists", async () => {
    const freshPool = createDestPool();
    try {
      await setupTestSchema(freshPool);
      await insertBaselineRows(freshPool);

      const diff = await generateDiff(sourcePool, freshPool, {
        schema: SCHEMA,
        tables: ["type_test_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: false,
        skipMissingPk: false,
        verbose: false,
      });

      // Apply in upsert mode
      const summary = await runApply(freshPool, diff, {
        dryRun: false,
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: false,
        conflictMode: "overwrite",
        insertMode: "upsert",
        transaction: true,
        verbose: false,
      });

      expect(summary.applied.inserts).toBeGreaterThanOrEqual(1);
    } finally {
      await freshPool.end();
    }
  });

  it("null->value and value->null updates round-trip correctly", async () => {
    const freshPool = createDestPool();
    try {
      await setupTestSchema(freshPool);
      await insertBaselineRows(freshPool);

      // Row 1 in source: nullable_text = 'now has value', nullable_int = NULL
      // Row 1 in dest (baseline): nullable_text = 'some text', nullable_int = 42
      // So this exercises value->null and null->value transitions

      const diff = await generateDiff(sourcePool, freshPool, {
        schema: SCHEMA,
        tables: ["type_test_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: false,
        skipMissingPk: false,
        verbose: false,
      });

      const tableDiff = diff.tables.find((t) => t.table === "type_test_table");
      const row1 = tableDiff!.updates.find((u) => u.pk["id"] === 1);
      expect(row1).toBeDefined();
      expect(row1!.changes["nullable_text"]).toBeDefined(); // 'some text' -> 'now has value'
      expect(row1!.changes["nullable_int"]).toBeDefined(); // 42 -> NULL

      await runApply(freshPool, diff, {
        dryRun: false,
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: false,
        conflictMode: "abort",
        insertMode: "strict",
        transaction: true,
        verbose: false,
      });

      const client = await freshPool.connect();
      try {
        const result = await client.query(
          "SELECT nullable_text, nullable_int FROM type_test_table WHERE id = 1",
        );
        expect(result.rows[0].nullable_text).toBe("now has value");
        expect(result.rows[0].nullable_int).toBeNull();
      } finally {
        client.release();
      }
    } finally {
      await freshPool.end();
    }
  });

  it("bytea round-trip preserves binary data", async () => {
    const freshPool = createDestPool();
    try {
      await setupTestSchema(freshPool);
      await insertBaselineRows(freshPool);

      // Generate diff for row 4 (insert with bytea)
      const diff = await generateDiff(sourcePool, freshPool, {
        schema: SCHEMA,
        tables: ["type_test_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: false,
        skipMissingPk: false,
        verbose: false,
      });

      await runApply(freshPool, diff, {
        dryRun: false,
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: false,
        conflictMode: "abort",
        insertMode: "strict",
        transaction: true,
        verbose: false,
      });

      // Check bytea value in row 4 matches source
      const srcClient = await sourcePool.connect();
      const dstClient = await freshPool.connect();
      try {
        const srcResult = await srcClient.query(
          "SELECT bytea_val FROM type_test_table WHERE id = 4",
        );
        const dstResult = await dstClient.query(
          "SELECT bytea_val FROM type_test_table WHERE id = 4",
        );
        expect(dstResult.rows[0].bytea_val.toString("hex")).toBe(
          srcResult.rows[0].bytea_val.toString("hex"),
        );
      } finally {
        srcClient.release();
        dstClient.release();
      }
    } finally {
      await freshPool.end();
    }
  });

  it("jsonb structural equality: reordered keys do not produce false diff", async () => {
    const freshPool = createDestPool();
    try {
      await setupTestSchema(freshPool);

      // Insert row with specific jsonb key order in source
      const srcClient = await sourcePool.connect();
      try {
        await srcClient.query(`
          INSERT INTO type_test_table (id, text_val, varchar_val, char_val, bool_val,
            date_val, time_val, timetz_val, timestamp_val, timestamptz_val, interval_val,
            uuid_val, json_val, jsonb_val, bytea_val, text_array_val, int_array_val, uuid_array_val,
            inet_val, cidr_val, macaddr_val, point_val,
            int4range_val, numrange_val, tsrange_val, tstzrange_val, daterange_val,
            mood_val, domain_val)
          VALUES (
            99, 'jsonb_test', 'jtest', 'json ',
            true, '2026-01-01', '10:00:00', '10:00:00+00', '2026-01-01 10:00:00', '2026-01-01 10:00:00+00',
            '1 hour', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
            '{}', '{"b": 2, "a": 1}',
            decode('74657374', 'hex'),
            ARRAY['x'], ARRAY[0], ARRAY['e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99'::uuid],
            '1.2.3.4', '1.2.3.0/24', '11:22:33:44:55:66',
            '(0,0)',
            '[0,1]', '[0,1]', '[2026-01-01,2026-01-02)', '[2026-01-01 00:00:00+00,2026-01-02 00:00:00+00)', '[2026-01-01,2026-01-02)',
            'happy', 5
          )
          ON CONFLICT (id) DO UPDATE SET jsonb_val = EXCLUDED.jsonb_val
        `);
      } finally {
        srcClient.release();
      }

      // Insert same row with different key order in dest
      const dstClient = await freshPool.connect();
      try {
        await dstClient.query(`
          INSERT INTO type_test_table (id, text_val, varchar_val, char_val, bool_val,
            date_val, time_val, timetz_val, timestamp_val, timestamptz_val, interval_val,
            uuid_val, json_val, jsonb_val, bytea_val, text_array_val, int_array_val, uuid_array_val,
            inet_val, cidr_val, macaddr_val, point_val,
            int4range_val, numrange_val, tsrange_val, tstzrange_val, daterange_val,
            mood_val, domain_val)
          VALUES (
            99, 'jsonb_test', 'jtest', 'json ',
            true, '2026-01-01', '10:00:00', '10:00:00+00', '2026-01-01 10:00:00', '2026-01-01 10:00:00+00',
            '1 hour', 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99',
            '{}', '{"a": 1, "b": 2}',
            decode('74657374', 'hex'),
            ARRAY['x'], ARRAY[0], ARRAY['e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99'::uuid],
            '1.2.3.4', '1.2.3.0/24', '11:22:33:44:55:66',
            '(0,0)',
            '[0,1]', '[0,1]', '[2026-01-01,2026-01-02)', '[2026-01-01 00:00:00+00,2026-01-02 00:00:00+00)', '[2026-01-01,2026-01-02)',
            'happy', 5
          )
        `);
      } finally {
        dstClient.release();
      }

      // The diff should NOT produce an update for row 99 since the jsonb values are structurally equal
      // (PostgreSQL normalizes jsonb key order anyway, but this tests our comparison logic)
      const diff = await generateDiff(sourcePool, freshPool, {
        schema: SCHEMA,
        tables: ["type_test_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: false,
        skipMissingPk: false,
        verbose: false,
      });

      const tableDiff = diff.tables.find((t) => t.table === "type_test_table");
      const row99Update = tableDiff?.updates.find((u) => u.pk["id"] === 99);
      // Should not have a jsonb_val change (PostgreSQL normalizes JSONB key order)
      if (row99Update) {
        expect(row99Update.changes["jsonb_val"]).toBeUndefined();
      }
    } finally {
      await freshPool.end();
    }
  });
});

describe("generateSqlScript integration", () => {
  it("applies generated SQL and makes destination equal to source", async () => {
    const freshSourcePool = createSourcePool();
    const freshDestPool = createDestPool();
    try {
      await setupTestSchema(freshSourcePool);
      await setupTestSchema(freshDestPool);
      await insertBaselineRows(freshSourcePool);
      await insertBaselineRows(freshDestPool);

      const sourceClient = await freshSourcePool.connect();
      try {
        await sourceClient.query(`
          UPDATE composite_pk_table
          SET name = 'UPDATED', value = 'value-updated'
          WHERE tenant_id = 1 AND item_id = 1
        `);
        await sourceClient.query(`
          INSERT INTO composite_pk_table (tenant_id, item_id, name, value)
          VALUES (3, 1, 'tenant3-item1', 'value-new')
        `);
        await sourceClient.query(`
          DELETE FROM composite_pk_table
          WHERE tenant_id = 1 AND item_id = 2
        `);
      } finally {
        sourceClient.release();
      }

      const diff = await generateDiff(freshSourcePool, freshDestPool, {
        schema: SCHEMA,
        tables: ["composite_pk_table"],
        excludeTables: [],
        ignoreColumns: [],
        includeDeletes: true,
        skipMissingPk: false,
        verbose: false,
      });

      expect(diff.summary.inserts).toBeGreaterThanOrEqual(1);
      expect(diff.summary.updates).toBeGreaterThanOrEqual(1);
      expect(diff.summary.deletes).toBeGreaterThanOrEqual(1);

      const sqlResult = generateSqlScript(diff, {
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: true,
        transaction: true,
      });

      const client = await freshDestPool.connect();
      try {
        await client.query(sqlResult.sql);
      } finally {
        client.release();
      }

      const verificationDiff = await generateDiff(
        freshSourcePool,
        freshDestPool,
        {
          schema: SCHEMA,
          tables: ["composite_pk_table"],
          excludeTables: [],
          ignoreColumns: [],
          includeDeletes: true,
          skipMissingPk: false,
          verbose: false,
        },
      );

      expect(verificationDiff.tables).toEqual([]);
      expect(verificationDiff.summary.tablesCompared).toBe(1);
      expect(verificationDiff.summary.inserts).toBe(0);
      expect(verificationDiff.summary.updates).toBe(0);
      expect(verificationDiff.summary.deletes).toBe(0);
    } finally {
      await freshSourcePool.end();
      await freshDestPool.end();
    }
  });
});

describe("generateSchemaDiff integration", () => {
  it("applies generated schema SQL and makes destination schema equal to source", async () => {
    const freshSourcePool = createSourcePool();
    const freshDestPool = createDestPool();
    const schemaTables = [
      "schema_shared_table",
      "schema_source_only",
      "schema_dest_only",
    ];

    async function resetSchemaTables(
      pool: ReturnType<typeof createSourcePool>,
    ): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query(`
          DROP TABLE IF EXISTS schema_dest_only;
          DROP TABLE IF EXISTS schema_source_only;
          DROP TABLE IF EXISTS schema_shared_table;
        `);
      } finally {
        client.release();
      }
    }

    try {
      await resetSchemaTables(freshSourcePool);
      await resetSchemaTables(freshDestPool);

      const sourceClient = await freshSourcePool.connect();
      try {
        await sourceClient.query(`
          CREATE TABLE schema_shared_table (
            id integer PRIMARY KEY,
            name text NOT NULL DEFAULT 'source-name',
            source_only text
          );

          CREATE TABLE schema_source_only (
            id integer PRIMARY KEY,
            label text NOT NULL
          );
        `);
      } finally {
        sourceClient.release();
      }

      const destClient = await freshDestPool.connect();
      try {
        await destClient.query(`
          CREATE TABLE schema_shared_table (
            legacy_id integer PRIMARY KEY,
            name character varying(50),
            old_col integer
          );

          CREATE TABLE schema_dest_only (
            id integer PRIMARY KEY,
            note text
          );
        `);
      } finally {
        destClient.release();
      }

      const diff = await generateSchemaDiff(freshSourcePool, freshDestPool, {
        schema: SCHEMA,
        tables: schemaTables,
        excludeTables: [],
        verbose: false,
      });

      expect(diff.summary.tablesCompared).toBe(3);
      expect(diff.summary.tablesToCreate).toBe(1);
      expect(diff.summary.tablesToDrop).toBe(1);
      expect(diff.summary.columnsToAdd).toBeGreaterThanOrEqual(1);
      expect(diff.summary.columnsToAlter).toBeGreaterThanOrEqual(1);
      expect(diff.summary.columnsToDrop).toBeGreaterThanOrEqual(1);
      expect(diff.summary.primaryKeysToChange).toBe(1);

      const sqlResult = generateSchemaSqlScript(diff, {
        transaction: true,
        includeDrops: true,
      });

      const client = await freshDestPool.connect();
      try {
        await client.query(sqlResult.sql);
      } finally {
        client.release();
      }

      const verificationDiff = await generateSchemaDiff(
        freshSourcePool,
        freshDestPool,
        {
          schema: SCHEMA,
          tables: schemaTables,
          excludeTables: [],
          verbose: false,
        },
      );

      expect(verificationDiff.tables).toEqual([]);
      expect(verificationDiff.summary).toEqual({
        tablesCompared: 3,
        tablesToCreate: 0,
        tablesToDrop: 0,
        columnsToAdd: 0,
        columnsToAlter: 0,
        columnsToDrop: 0,
        primaryKeysToChange: 0,
      });
    } finally {
      await resetSchemaTables(freshSourcePool);
      await resetSchemaTables(freshDestPool);
      await freshSourcePool.end();
      await freshDestPool.end();
    }
  });
});
