import { describe, expect, it } from "vitest";
import {
  generateSqlScript,
  buildSqlOutputPath,
} from "../../src/sql/generate-sql";
import type { DiffJson } from "../../src/diff/diff-schema";

const diff: DiffJson = {
  format: "postgres-data-diff-json/v1",
  generatedAt: "2026-05-12T18:00:00.000Z",
  source: { schema: "public" },
  dest: { schema: "public" },
  options: {
    includeDeletes: true,
    ignoredColumns: [],
  },
  tables: [
    {
      schema: "public",
      table: "directus_users",
      primaryKey: ["id"],
      columnTypes: {
        id: "integer",
        email: "character varying",
        tags: "ARRAY",
        profile: "jsonb",
        avatar: "bytea",
        roles: "ARRAY",
      },
      inserts: [
        {
          row: {
            id: 2,
            email: "o'hara@example.com",
            tags: ["admin", "editor"],
            profile: { role: "admin" },
            avatar: { $type: "bytea", $value: "SGVsbG8=" },
          },
        },
      ],
      updates: [
        {
          pk: { id: 1 },
          changes: {
            email: { from: "old@example.com", to: "new'o@example.com" },
            tags: { from: ["viewer"], to: ["editor", "owner"] },
          },
          guard: {
            id: 1,
            email: "old@example.com",
            roles: ["viewer", "billing"],
            profile: { role: "editor" },
          },
        },
      ],
      deletes: [
        {
          pk: { id: 3 },
          guard: {
            id: 3,
            email: "gone@example.com",
          },
        },
      ],
    },
  ],
  summary: {
    tablesCompared: 1,
    inserts: 1,
    updates: 1,
    deletes: 1,
    skippedTables: [],
  },
};

const directusLikeJsonDiff: DiffJson = {
  format: "postgres-data-diff-json/v1",
  generatedAt: "2026-05-12T18:00:00.000Z",
  source: { schema: "public" },
  dest: { schema: "public" },
  options: {
    includeDeletes: true,
    ignoredColumns: [],
  },
  tables: [
    {
      schema: "public",
      table: "directus_fields",
      primaryKey: ["id"],
      columnTypes: {
        id: "integer",
        collection: "character varying",
        field: "character varying",
        options: "json",
        display_options: "json",
        translations: "json",
      },
      inserts: [
        {
          row: {
            id: 101,
            collection: "courses",
            field: "class_link",
            options: { placeholder: "Status" },
            display_options: { icon: "link", help: "C:\\path\\John's" },
            translations: [
              { language: "en-US", translation: "Link para os alunos" },
              { language: "pt-BR", translation: "Link para os alunos" },
            ],
          },
        },
      ],
      updates: [
        {
          pk: { id: 102 },
          changes: {
            translations: {
              from: [{ language: "en-US", translation: "Old" }],
              to: [
                {
                  language: "en-US",
                  translation: "John's status",
                },
              ],
            },
          },
          guard: {
            id: 102,
            translations: [{ language: "en-US", translation: "Old" }],
          },
        },
      ],
      deletes: [],
    },
    {
      schema: "public",
      table: "directus_notifications",
      primaryKey: ["id"],
      columnTypes: {
        id: "integer",
        options: "jsonb",
        labels: "ARRAY",
      },
      inserts: [
        {
          row: {
            id: 1,
            options: { template: "{{avatar}} {{first_name}} {{last_name}}" },
            labels: ["welcome", "students"],
          },
        },
      ],
      updates: [
        {
          pk: { id: 1 },
          changes: {
            options: {
              from: { template: "x" },
              to: { template: "y" },
            },
          },
          guard: {
            id: 1,
            options: { template: "x" },
            labels: ["welcome", "students"],
          },
        },
      ],
      deletes: [],
    },
  ],
  summary: {
    tablesCompared: 2,
    inserts: 2,
    updates: 2,
    deletes: 0,
    skippedTables: [],
  },
};

describe("generateSqlScript", () => {
  it("builds a sql output path from the input path", () => {
    expect(buildSqlOutputPath("frg-data-diff.json")).toBe("frg-data-diff.sql");
    expect(buildSqlOutputPath("diff-output")).toBe("diff-output.sql");
  });

  it("generates plain SQL statements with escaped values and no placeholders", () => {
    const result = generateSqlScript(diff, {
      applyInserts: true,
      applyUpdates: true,
      applyDeletes: true,
      transaction: true,
    });

    expect(result.summary).toEqual({
      inserts: 1,
      updates: 1,
      deletes: 1,
    });
    expect(result.sql).toContain("BEGIN;");
    expect(result.sql).toContain("COMMIT;");
    expect(result.sql).toContain(`INSERT INTO "public"."directus_users"`);
    expect(result.sql).toContain(`'o''hara@example.com'`);
    expect(result.sql).toContain(`'{"admin","editor"}'`);
    expect(result.sql).toContain(`decode('SGVsbG8=', 'base64')`);
    expect(result.sql).toContain(
      `UPDATE "public"."directus_users" SET "email" = 'new''o@example.com'`,
    );
    expect(result.sql).toContain(`"tags" = '{"editor","owner"}'`);
    expect(result.sql).toContain(
      `"roles" IS NOT DISTINCT FROM '{"viewer","billing"}'`,
    );
    expect(result.sql).toContain(
      `"profile"::jsonb IS NOT DISTINCT FROM '{"role":"editor"}'::jsonb`,
    );
    expect(result.sql).toContain(`DELETE FROM "public"."directus_users"`);
    expect(result.sql).not.toMatch(/\$\d+/);
  });

  it("honors apply flags", () => {
    const result = generateSqlScript(diff, {
      applyInserts: false,
      applyUpdates: true,
      applyDeletes: false,
      transaction: false,
    });

    expect(result.summary).toEqual({
      inserts: 0,
      updates: 1,
      deletes: 0,
    });
    expect(result.sql).not.toContain("INSERT INTO");
    expect(result.sql).toContain("UPDATE");
    expect(result.sql).not.toContain("DELETE FROM");
    expect(result.sql).not.toContain("BEGIN;");
  });

  it("throws for NaN values", () => {
    const invalidDiff: DiffJson = {
      ...diff,
      tables: [
        {
          ...diff.tables[0],
          inserts: [
            {
              row: {
                id: 99,
                score: Number.NaN,
              },
            },
          ],
          updates: [],
          deletes: [],
        },
      ],
    };

    expect(() =>
      generateSqlScript(invalidDiff, {
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: true,
        transaction: true,
      }),
    ).toThrow("Cannot generate SQL for non-finite number: NaN");
  });

  it("throws for Infinity values", () => {
    const invalidDiff: DiffJson = {
      ...diff,
      tables: [
        {
          ...diff.tables[0],
          inserts: [
            {
              row: {
                id: 99,
                score: Number.POSITIVE_INFINITY,
              },
            },
          ],
          updates: [],
          deletes: [],
        },
      ],
    };

    expect(() =>
      generateSqlScript(invalidDiff, {
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: true,
        transaction: true,
      }),
    ).toThrow("Cannot generate SQL for non-finite number: Infinity");
  });

  it("throws for negative Infinity values", () => {
    const invalidDiff: DiffJson = {
      ...diff,
      tables: [
        {
          ...diff.tables[0],
          inserts: [
            {
              row: {
                id: 99,
                score: Number.NEGATIVE_INFINITY,
              },
            },
          ],
          updates: [],
          deletes: [],
        },
      ],
    };

    expect(() =>
      generateSqlScript(invalidDiff, {
        applyInserts: true,
        applyUpdates: true,
        applyDeletes: true,
        transaction: true,
      }),
    ).toThrow("Cannot generate SQL for non-finite number: -Infinity");
  });

  it("renders json/jsonb literals by real column type and does not render JSON arrays as PostgreSQL ARRAY expressions", () => {
    const result = generateSqlScript(directusLikeJsonDiff, {
      applyInserts: true,
      applyUpdates: true,
      applyDeletes: false,
      transaction: false,
    });

    expect(result.sql).toContain(
      `"translations" = '[{"language":"en-US","translation":"John''s status"}]'::json`,
    );
    expect(result.sql).toContain(
      `'[{"language":"en-US","translation":"Link para os alunos"},{"language":"pt-BR","translation":"Link para os alunos"}]'::json`,
    );
    expect(result.sql).toContain(
      `'{"icon":"link","help":"C:\\\\path\\\\John''s"}'::json`,
    );
    expect(result.sql).toContain(
      `'{"template":"{{avatar}} {{first_name}} {{last_name}}"}'::jsonb`,
    );
    expect(result.sql).toContain(
      `"translations"::jsonb IS NOT DISTINCT FROM '[{"language":"en-US","translation":"Old"}]'::jsonb`,
    );
    expect(result.sql).toContain(
      `"options"::jsonb IS NOT DISTINCT FROM '{"template":"x"}'::jsonb`,
    );
    expect(result.sql).toContain(`'{"welcome","students"}'`);
    expect(result.sql).not.toContain(`"translations" = ARRAY[`);
    expect(result.sql).not.toContain(
      `"translations"::jsonb IS NOT DISTINCT FROM ARRAY[`,
    );
    expect(result.sql).not.toContain("\\'");
  });
});
