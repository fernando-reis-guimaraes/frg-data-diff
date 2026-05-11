import { describe, expect, it } from "vitest";
import { resolveTablePatternsFromTableLists } from "../../src/db/metadata";

describe("resolveTablePatternsFromTableLists", () => {
  it("expands wildcard include patterns against tables present in both databases", () => {
    const result = resolveTablePatternsFromTableLists(
      ["directus_users", "directus_roles", "custom_table"],
      ["directus_users", "directus_roles", "other_table"],
      ["directus_*"],
      [],
    );

    expect(result.tables).toEqual(["directus_users", "directus_roles"]);
    expect(result.excludedTables).toEqual([]);
  });

  it("supports wildcard excludes after include expansion", () => {
    const result = resolveTablePatternsFromTableLists(
      ["directus_users", "directus_roles", "directus_sessions"],
      ["directus_users", "directus_roles", "directus_sessions"],
      ["directus_*"],
      ["*_sessions"],
    );

    expect(result.tables).toEqual(["directus_users", "directus_roles"]);
    expect(result.excludedTables).toEqual(["directus_sessions"]);
  });

  it("throws a clear error when a literal table is missing from one database", () => {
    expect(() =>
      resolveTablePatternsFromTableLists(
        ["directus_users"],
        [],
        ["directus_users"],
        [],
      ),
    ).toThrow(
      'Table "directus_users" was not found in the destination database.',
    );
  });

  it("throws a clear error when a wildcard matches nothing in common", () => {
    expect(() =>
      resolveTablePatternsFromTableLists(
        ["directus_users"],
        ["other_table"],
        ["directus_*"],
        [],
      ),
    ).toThrow(
      'Table pattern "directus_*" matched no tables present in both databases.',
    );
  });

  it("supports schema diff resolution against tables present in either database", () => {
    const result = resolveTablePatternsFromTableLists(
      ["directus_users", "source_only_table"],
      ["directus_users", "dest_only_table"],
      ["*_table"],
      ["dest_*"],
      { availability: "either" },
    );

    expect(result.tables).toEqual(["source_only_table"]);
    expect(result.excludedTables).toEqual(["dest_only_table"]);
  });
});
