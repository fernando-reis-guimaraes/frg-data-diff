import { describe, it, expect } from "vitest";
import { diffJsonSchema, validateDiffJson } from "../../src/diff/diff-schema";

const validDiff = {
  format: "postgres-data-diff-json/v1",
  generatedAt: "2026-05-11T21:00:00.000Z",
  source: { schema: "public" },
  dest: { schema: "public" },
  options: {
    includeDeletes: true,
    ignoredColumns: ["updated_at"],
  },
  tables: [
    {
      schema: "public",
      table: "example_table",
      primaryKey: ["id"],
      updates: [
        {
          pk: { id: 1 },
          changes: {
            name: { from: "Old value", to: "New value" },
          },
          guard: { id: 1, name: "Old value", status: "active" },
        },
      ],
      inserts: [
        {
          row: { id: 2, name: "Inserted value" },
        },
      ],
      deletes: [
        {
          pk: { id: 3 },
          guard: { id: 3, name: "Deleted value" },
        },
      ],
    },
  ],
  summary: {
    tablesCompared: 1,
    updates: 1,
    inserts: 1,
    deletes: 1,
    skippedTables: [],
  },
};

describe("diffJsonSchema", () => {
  it("validates a correct diff JSON", () => {
    const result = diffJsonSchema.safeParse(validDiff);
    expect(result.success).toBe(true);
  });

  it("rejects wrong format string", () => {
    const result = diffJsonSchema.safeParse({
      ...validDiff,
      format: "wrong-format",
    });
    expect(result.success).toBe(false);
  });

  it("requires tables array", () => {
    const { tables: _, ...rest } = validDiff;
    const result = diffJsonSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("requires summary", () => {
    const { summary: _, ...rest } = validDiff;
    const result = diffJsonSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("allows empty tables array", () => {
    const result = diffJsonSchema.safeParse({
      ...validDiff,
      tables: [],
      summary: {
        ...validDiff.summary,
        tablesCompared: 0,
        updates: 0,
        inserts: 0,
        deletes: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it("allows empty deletes array in table", () => {
    const result = diffJsonSchema.safeParse({
      ...validDiff,
      tables: [{ ...validDiff.tables[0], deletes: [] }],
    });
    expect(result.success).toBe(true);
  });

  it("allows composite primary key", () => {
    const result = diffJsonSchema.safeParse({
      ...validDiff,
      tables: [
        {
          ...validDiff.tables[0],
          primaryKey: ["tenant_id", "id"],
          updates: [
            {
              pk: { tenant_id: 1, id: 1 },
              changes: { name: { from: "a", to: "b" } },
              guard: { tenant_id: 1, id: 1, name: "a" },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("validateDiffJson", () => {
  it("returns validated diff on success", () => {
    const result = validateDiffJson(validDiff);
    expect(result.format).toBe("postgres-data-diff-json/v1");
    expect(result.tables.length).toBe(1);
  });

  it("throws on invalid diff JSON", () => {
    expect(() => validateDiffJson({ format: "wrong" })).toThrow();
  });

  it("throws with descriptive message", () => {
    expect(() => validateDiffJson({ format: "wrong" })).toThrow(
      /Invalid diff JSON/,
    );
  });
});
