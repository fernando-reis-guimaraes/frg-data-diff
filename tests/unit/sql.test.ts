import { describe, it, expect } from "vitest";
import {
  buildPkWhereClause,
  buildNullSafeWhereClause,
  buildSelectRowsQuery,
} from "../../src/db/sql";

describe("buildPkWhereClause", () => {
  it("builds a simple single-column PK where clause", () => {
    const { clause, params } = buildPkWhereClause(["id"], { id: 42 });
    expect(clause).toBe('"id" = $1');
    expect(params).toEqual([42]);
  });

  it("builds a composite PK where clause", () => {
    const { clause, params } = buildPkWhereClause(["tenant_id", "id"], {
      tenant_id: 1,
      id: 2,
    });
    expect(clause).toBe('"tenant_id" = $1 AND "id" = $2');
    expect(params).toEqual([1, 2]);
  });

  it("respects custom start index", () => {
    const { clause, params } = buildPkWhereClause(["id"], { id: 5 }, 3);
    expect(clause).toBe('"id" = $3');
    expect(params).toEqual([5]);
  });

  it("handles null PK value", () => {
    const { clause, params } = buildPkWhereClause(["id"], { id: null });
    expect(clause).toBe('"id" = $1');
    expect(params).toEqual([null]);
  });
});

describe("buildSelectRowsQuery", () => {
  it("keeps the existing SELECT shape when no data filter is configured", () => {
    const query = buildSelectRowsQuery({
      schema: "public",
      table: "directus_presets",
      columns: ["id", "user"],
      pkColumns: ["id"],
      limitParam: 1,
      offsetParam: 2,
    });

    expect(query).toBe(
      'SELECT "id", "user" FROM "public"."directus_presets" ORDER BY "id" LIMIT $1 OFFSET $2',
    );
  });

  it("appends a table-specific data filter without rewriting it", () => {
    const query = buildSelectRowsQuery({
      schema: "public",
      table: "directus_presets",
      columns: ["id", "user"],
      pkColumns: ["id"],
      limitParam: 1,
      offsetParam: 2,
      whereDataFilter: '"user" IS NULL',
    });

    expect(query).toBe(
      'SELECT "id", "user" FROM "public"."directus_presets" WHERE ("user" IS NULL) ORDER BY "id" LIMIT $1 OFFSET $2',
    );
  });
});

describe("buildNullSafeWhereClause", () => {
  it("uses IS NOT DISTINCT FROM for each column", () => {
    const { clause, params } = buildNullSafeWhereClause(["name", "status"], {
      name: "Alice",
      status: null,
    });
    expect(clause).toBe(
      '"name" IS NOT DISTINCT FROM $1 AND "status" IS NOT DISTINCT FROM $2',
    );
    expect(params).toEqual(["Alice", null]);
  });

  it("handles single column", () => {
    const { clause, params } = buildNullSafeWhereClause(["col"], {
      col: "value",
    });
    expect(clause).toBe('"col" IS NOT DISTINCT FROM $1');
    expect(params).toEqual(["value"]);
  });

  it("respects custom start index", () => {
    const { clause, params } = buildNullSafeWhereClause(
      ["col"],
      { col: "v" },
      5,
    );
    expect(clause).toBe('"col" IS NOT DISTINCT FROM $5');
    expect(params).toEqual(["v"]);
  });

  it("handles empty columns array", () => {
    const { clause, params } = buildNullSafeWhereClause([], {});
    expect(clause).toBe("");
    expect(params).toEqual([]);
  });

  it("uses jsonb cast for json columns when type map is provided", () => {
    const jsonVal = { key: "value" };
    const { clause, params } = buildNullSafeWhereClause(
      ["json_col"],
      { json_col: jsonVal },
      1,
      { json_col: "json" },
    );
    expect(clause).toBe('"json_col"::jsonb IS NOT DISTINCT FROM $1::jsonb');
    expect(params).toEqual([JSON.stringify(jsonVal)]);
  });

  it("uses jsonb cast for jsonb columns when type map is provided", () => {
    const jsonbVal = { key: "value" };
    const { clause, params } = buildNullSafeWhereClause(
      ["jb_col"],
      { jb_col: jsonbVal },
      1,
      { jb_col: "jsonb" },
    );
    expect(clause).toBe('"jb_col"::jsonb IS NOT DISTINCT FROM $1::jsonb');
    expect(params).toEqual([JSON.stringify(jsonbVal)]);
  });

  it("uses explicit point cast when type map is provided", () => {
    // point type has no equality operator in PostgreSQL, so it should be SKIPPED
    const { clause, params } = buildNullSafeWhereClause(
      ["pt_col", "other_col"],
      { pt_col: "(1,2)", other_col: "value" },
      1,
      { pt_col: "point", other_col: "text" },
    );
    // pt_col should be skipped, only other_col should appear
    expect(clause).toBe('"other_col" IS NOT DISTINCT FROM $1');
    expect(params).toEqual(["value"]);
  });

  it("uses explicit interval cast when type map is provided", () => {
    const { clause, params } = buildNullSafeWhereClause(
      ["iv_col"],
      { iv_col: "01:30:00" },
      1,
      { iv_col: "interval" },
    );
    expect(clause).toBe('"iv_col" IS NOT DISTINCT FROM $1::interval');
    expect(params).toEqual(["01:30:00"]);
  });

  it("uses regular comparison for null values even with type map", () => {
    const { clause, params } = buildNullSafeWhereClause(
      ["json_col"],
      { json_col: null },
      1,
      { json_col: "json" },
    );
    expect(clause).toBe('"json_col" IS NOT DISTINCT FROM $1');
    expect(params).toEqual([null]);
  });
});
