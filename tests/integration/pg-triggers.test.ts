/**
 * Integration tests for the pg-triggers diff tool.
 *
 * Prerequisites: docker-compose up must be running with pg_source and pg_dest.
 * Set these env vars:
 *   PG_SOURCE_HOST, PG_SOURCE_PORT, PG_SOURCE_DB, PG_SOURCE_USER, PG_SOURCE_PASSWORD
 *   PG_DEST_HOST, PG_DEST_PORT, PG_DEST_DB, PG_DEST_USER, PG_DEST_PASSWORD
 *
 * Or use the defaults (localhost:15432 and localhost:15433).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createSourcePool, createDestPool } from "./helpers";
import { generatePgTriggersDiffSql } from "../../src/diff/pg-triggers-diff";
import {
  fetchTriggersAndFunctions,
  fetchTriggersAndFunctionsForTables,
} from "../../src/db/pg-triggers";

const SCHEMA = "public";
const TRIGGER_TABLE = "pg_trigger_test_table";

let sourcePool: ReturnType<typeof createSourcePool>;
let destPool: ReturnType<typeof createDestPool>;

async function setupTriggerTestSchema(
  pool: ReturnType<typeof createSourcePool>,
  options: {
    includeTrigger?: boolean;
    functionBody?: string;
    triggerTiming?: string;
  } = {},
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`DROP TABLE IF EXISTS ${TRIGGER_TABLE} CASCADE`);
    await client.query(`
      CREATE TABLE ${TRIGGER_TABLE} (
        id    serial PRIMARY KEY,
        name  text NOT NULL,
        value integer DEFAULT 0,
        updated_at timestamp DEFAULT now()
      )
    `);

    if (options.includeTrigger !== false) {
      const body =
        options.functionBody ??
        `
          NEW.updated_at = now();
          RETURN NEW;
        `;
      await client.query(`
        CREATE OR REPLACE FUNCTION trigger_test_fn()
        RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          ${body}
        END;
        $$
      `);

      const timing = options.triggerTiming ?? "BEFORE UPDATE";
      await client.query(`
        CREATE TRIGGER trg_test_update
        ${timing} ON ${TRIGGER_TABLE}
        FOR EACH ROW
        EXECUTE FUNCTION trigger_test_fn()
      `);
    }
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  sourcePool = createSourcePool();
  destPool = createDestPool();
}, 30000);

afterAll(async () => {
  // Clean up trigger test tables
  const srcClient = await sourcePool.connect();
  try {
    await srcClient.query(`DROP TABLE IF EXISTS ${TRIGGER_TABLE} CASCADE`);
    await srcClient.query(`DROP FUNCTION IF EXISTS trigger_test_fn() CASCADE`);
  } finally {
    srcClient.release();
  }

  const destClient = await destPool.connect();
  try {
    await destClient.query(`DROP TABLE IF EXISTS ${TRIGGER_TABLE} CASCADE`);
    await destClient.query(`DROP FUNCTION IF EXISTS trigger_test_fn() CASCADE`);
  } finally {
    destClient.release();
  }

  await sourcePool.end();
  await destPool.end();
});

// ---------------------------------------------------------------------------
//  fetchTriggersAndFunctions
// ---------------------------------------------------------------------------

describe("fetchTriggersAndFunctions", () => {
  it("returns triggers and functions for a table with a trigger", async () => {
    await setupTriggerTestSchema(sourcePool, { includeTrigger: true });

    const client = await sourcePool.connect();
    try {
      const result = await fetchTriggersAndFunctions(
        client,
        SCHEMA,
        TRIGGER_TABLE,
      );

      expect(result.table).toBe(TRIGGER_TABLE);
      expect(result.triggers.length).toBeGreaterThanOrEqual(1);
      expect(result.functions.length).toBeGreaterThanOrEqual(1);

      const trg = result.triggers.find(
        (t) => t.triggerName === "trg_test_update",
      );
      expect(trg).toBeDefined();
      expect(trg!.triggerDefinition).toContain("trg_test_update");

      const fn = result.functions.find(
        (f) => f.functionName === "trigger_test_fn",
      );
      expect(fn).toBeDefined();
      expect(fn!.functionDefinition).toContain("trigger_test_fn");
    } finally {
      client.release();
    }
  });

  it("returns empty arrays for a table without triggers", async () => {
    await setupTriggerTestSchema(sourcePool, { includeTrigger: false });

    const client = await sourcePool.connect();
    try {
      const result = await fetchTriggersAndFunctions(
        client,
        SCHEMA,
        TRIGGER_TABLE,
      );

      expect(result.table).toBe(TRIGGER_TABLE);
      expect(result.triggers).toEqual([]);
      expect(result.functions).toEqual([]);
    } finally {
      client.release();
    }
  });
});

// ---------------------------------------------------------------------------
//  fetchTriggersAndFunctionsForTables
// ---------------------------------------------------------------------------

describe("fetchTriggersAndFunctionsForTables", () => {
  it("returns results for multiple tables", async () => {
    await setupTriggerTestSchema(sourcePool, { includeTrigger: true });

    const client = await sourcePool.connect();
    try {
      // The test schema also has type_test_table (no triggers).
      // Use both tables to verify multi-table fetching.
      const results = await fetchTriggersAndFunctionsForTables(client, SCHEMA, [
        TRIGGER_TABLE,
      ]);

      expect(results.length).toBe(1);
      expect(results[0].table).toBe(TRIGGER_TABLE);
      expect(results[0].triggers.length).toBeGreaterThanOrEqual(1);
    } finally {
      client.release();
    }
  });
});

// ---------------------------------------------------------------------------
//  generatePgTriggersDiffSql
// ---------------------------------------------------------------------------

describe("generatePgTriggersDiffSql", () => {
  it("generates empty diff when both databases have identical triggers", async () => {
    await setupTriggerTestSchema(sourcePool, { includeTrigger: true });
    await setupTriggerTestSchema(destPool, { includeTrigger: true });

    const sql = await generatePgTriggersDiffSql(sourcePool, destPool, {
      schema: SCHEMA,
      tables: [TRIGGER_TABLE],
      excludeTables: [],
      verbose: false,
    });

    expect(sql).toContain("-- No differences found.");
    expect(sql).not.toContain("DROP TRIGGER");
    expect(sql).not.toContain("CREATE OR REPLACE");
  });

  it("generates CREATE OR REPLACE when source has a trigger that dest does not", async () => {
    await setupTriggerTestSchema(sourcePool, { includeTrigger: true });
    await setupTriggerTestSchema(destPool, { includeTrigger: false });

    const sql = await generatePgTriggersDiffSql(sourcePool, destPool, {
      schema: SCHEMA,
      tables: [TRIGGER_TABLE],
      excludeTables: [],
      verbose: false,
    });

    expect(sql).toContain("CREATE OR REPLACE FUNCTION");
    expect(sql).toContain("CREATE OR REPLACE TRIGGER");
    expect(sql).toContain("trigger_test_fn");
    expect(sql).toContain("trg_test_update");
    expect(sql).not.toContain("DROP TRIGGER");
  });

  it("generates DROP TRIGGER when dest has a trigger that source does not", async () => {
    await setupTriggerTestSchema(sourcePool, { includeTrigger: false });
    await setupTriggerTestSchema(destPool, { includeTrigger: true });

    const sql = await generatePgTriggersDiffSql(sourcePool, destPool, {
      schema: SCHEMA,
      tables: [TRIGGER_TABLE],
      excludeTables: [],
      verbose: false,
    });

    expect(sql).toContain("DROP TRIGGER IF EXISTS");
    expect(sql).toContain("trg_test_update");
    // The function used only by dest should be dropped
    expect(sql).toContain("DROP FUNCTION IF EXISTS");
    expect(sql).toContain("trigger_test_fn");
  });

  it("generates DROP + CREATE OR REPLACE when function body differs", async () => {
    await setupTriggerTestSchema(sourcePool, {
      includeTrigger: true,
      functionBody: `
        NEW.updated_at = now();
        NEW.value = NEW.value + 1;
        RETURN NEW;
      `,
    });
    await setupTriggerTestSchema(destPool, {
      includeTrigger: true,
      functionBody: `
        NEW.updated_at = now();
        RETURN NEW;
      `,
    });

    const sql = await generatePgTriggersDiffSql(sourcePool, destPool, {
      schema: SCHEMA,
      tables: [TRIGGER_TABLE],
      excludeTables: [],
      verbose: false,
    });

    // The function body changed, so it should be replaced
    expect(sql).toContain("CREATE OR REPLACE FUNCTION");
    expect(sql).toContain("trigger_test_fn");
    expect(sql).toContain("NEW.value = NEW.value + 1");
  });

  it("uses CREATE OR REPLACE syntax (never bare CREATE)", async () => {
    await setupTriggerTestSchema(sourcePool, { includeTrigger: true });
    await setupTriggerTestSchema(destPool, { includeTrigger: false });

    const sql = await generatePgTriggersDiffSql(sourcePool, destPool, {
      schema: SCHEMA,
      tables: [TRIGGER_TABLE],
      excludeTables: [],
      verbose: false,
    });

    // Verify we never have a bare CREATE FUNCTION or CREATE TRIGGER
    // (i.e., every CREATE should be CREATE OR REPLACE)
    const lines = sql.split("\n");
    for (const line of lines) {
      const trimmed = line.trim().toUpperCase();
      if (trimmed.startsWith("CREATE FUNCTION")) {
        throw new Error(`Found bare CREATE FUNCTION (no OR REPLACE): ${line}`);
      }
      if (trimmed.startsWith("CREATE TRIGGER")) {
        throw new Error(`Found bare CREATE TRIGGER (no OR REPLACE): ${line}`);
      }
    }
  });
});
