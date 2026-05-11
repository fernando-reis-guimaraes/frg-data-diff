import { describe, expect, it } from "vitest";
import {
  buildSchemaSqlOutputPath,
  generateSchemaSqlScript,
} from "../../src/schema-diff/generate-schema-sql";
import type { SchemaDiffJson } from "../../src/schema-diff/schema-diff-schema";

const schemaDiff: SchemaDiffJson = {
  format: "postgres-schema-diff-json/v1",
  generatedAt: "2026-05-13T00:00:00.000Z",
  source: { schema: "public" },
  dest: { schema: "public" },
  options: {
    tables: ["create_me", "drop_me", "shared_table"],
    excludedTables: [],
  },
  tables: [
    {
      table: "create_me",
      schema: "public",
      sourceExists: true,
      destExists: false,
      createTable: {
        columns: [
          {
            name: "id",
            type: "integer",
            nullable: false,
            default: null,
            isGenerated: false,
            generationExpression: null,
            ordinalPosition: 1,
          },
          {
            name: "name",
            type: "text",
            nullable: false,
            default: "'hello'",
            isGenerated: false,
            generationExpression: null,
            ordinalPosition: 2,
          },
        ],
        primaryKey: ["id"],
      },
      dropTable: false,
      addColumns: [],
      alterColumns: [],
      dropColumns: [],
      primaryKeyChange: null,
    },
    {
      table: "drop_me",
      schema: "public",
      sourceExists: false,
      destExists: true,
      createTable: null,
      dropTable: true,
      addColumns: [],
      alterColumns: [],
      dropColumns: [],
      primaryKeyChange: null,
    },
    {
      table: "shared_table",
      schema: "public",
      sourceExists: true,
      destExists: true,
      createTable: null,
      dropTable: false,
      addColumns: [
        {
          name: "new_col",
          type: "text",
          nullable: true,
          default: null,
          isGenerated: false,
          generationExpression: null,
          ordinalPosition: 3,
        },
      ],
      alterColumns: [
        {
          column: "name",
          from: {
            name: "name",
            type: "character varying(50)",
            nullable: true,
            default: null,
            isGenerated: false,
            generationExpression: null,
            ordinalPosition: 2,
          },
          to: {
            name: "name",
            type: "text",
            nullable: false,
            default: "'updated'",
            isGenerated: false,
            generationExpression: null,
            ordinalPosition: 2,
          },
        },
      ],
      dropColumns: [
        {
          name: "old_col",
          type: "integer",
          nullable: true,
          default: null,
          isGenerated: false,
          generationExpression: null,
          ordinalPosition: 4,
        },
      ],
      primaryKeyChange: {
        from: ["legacy_id"],
        to: ["id"],
        dropConstraintName: "shared_table_pkey",
      },
    },
  ],
  summary: {
    tablesCompared: 3,
    tablesToCreate: 1,
    tablesToDrop: 1,
    columnsToAdd: 1,
    columnsToAlter: 1,
    columnsToDrop: 1,
    primaryKeysToChange: 1,
  },
};

describe("generateSchemaSqlScript", () => {
  it("builds a schema sql output path from the input path", () => {
    expect(buildSchemaSqlOutputPath("frg-schema-diff.json")).toBe(
      "frg-schema-diff.sql",
    );
    expect(buildSchemaSqlOutputPath("schema-output")).toBe("schema-output.sql");
  });

  it("generates create, alter, and drop statements from a schema diff", () => {
    const result = generateSchemaSqlScript(schemaDiff, {
      transaction: true,
      includeDrops: true,
    });

    expect(result.sql).toContain("BEGIN;");
    expect(result.sql).toContain('CREATE TABLE "public"."create_me"');
    expect(result.sql).toContain("\"name\" text DEFAULT 'hello' NOT NULL");
    expect(result.sql).toContain('DROP TABLE IF EXISTS "public"."drop_me";');
    expect(result.sql).toContain(
      'ALTER TABLE "public"."shared_table" ADD COLUMN "new_col" text;',
    );
    expect(result.sql).toContain(
      'ALTER TABLE "public"."shared_table" ALTER COLUMN "name" TYPE text;',
    );
    expect(result.sql).toContain(
      'ALTER TABLE "public"."shared_table" ALTER COLUMN "name" SET DEFAULT \'updated\';',
    );
    expect(result.sql).toContain(
      'ALTER TABLE "public"."shared_table" ALTER COLUMN "name" SET NOT NULL;',
    );
    expect(result.sql).toContain(
      'ALTER TABLE "public"."shared_table" DROP COLUMN "old_col";',
    );
    expect(result.sql).toContain(
      'ALTER TABLE "public"."shared_table" DROP CONSTRAINT IF EXISTS "shared_table_pkey";',
    );
    expect(result.sql).toContain(
      'ALTER TABLE "public"."shared_table" ADD PRIMARY KEY ("id");',
    );
    expect(result.summary).toEqual({
      tablesToCreate: 1,
      tablesToDrop: 1,
      columnsToAdd: 1,
      columnsToAlter: 1,
      columnsToDrop: 1,
      primaryKeysToChange: 1,
    });
  });
});
