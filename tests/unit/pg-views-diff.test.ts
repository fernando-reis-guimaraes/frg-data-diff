import { describe, expect, it } from "vitest";
import { type Pool } from "pg";
import {
  resolvePgViewPatternsFromViewLists,
  type PgViewInfo,
} from "../../src/db/pg-views";
import { generatePgViewsDiffSql } from "../../src/diff/pg-views-diff";

const baseView: PgViewInfo = {
  viewSchema: "public",
  viewName: "active_users",
  viewType: "view",
  viewDefinition: " SELECT users.id, users.email\n   FROM users\n  WHERE users.active;",
};

describe("resolvePgViewPatternsFromViewLists", () => {
  it("defaults to all views present in either database", () => {
    const result = resolvePgViewPatternsFromViewLists(
      ["source_only_view", "shared_view"],
      ["dest_only_view", "shared_view"],
      [],
      [],
    );

    expect(result.views).toEqual([
      "dest_only_view",
      "shared_view",
      "source_only_view",
    ]);
    expect(result.excludedViews).toEqual([]);
  });

  it("applies wildcard includes and excludes", () => {
    const result = resolvePgViewPatternsFromViewLists(
      ["app_users_view", "app_orders_view", "legacy_view"],
      ["app_users_view", "app_orders_view", "legacy_view"],
      ["app_*"],
      ["*_orders_view"],
    );

    expect(result.views).toEqual(["app_users_view"]);
    expect(result.excludedViews).toEqual(["app_orders_view"]);
  });

  it("fails when an explicit view is missing from both databases", () => {
    expect(() =>
      resolvePgViewPatternsFromViewLists([], [], ["missing_view"], []),
    ).toThrow('View "missing_view" was not found');
  });

  it("fails when a wildcard matches no available views", () => {
    expect(() =>
      resolvePgViewPatternsFromViewLists(["app_view"], [], ["admin_*"], []),
    ).toThrow('View pattern "admin_*" matched no views.');
  });
});

describe("generatePgViewsDiffSql", () => {
  it("generates empty diff when view definitions are identical", async () => {
    const sourcePool = createMockPool([baseView]);
    const destPool = createMockPool([baseView]);

    const sql = await generatePgViewsDiffSql(sourcePool, destPool, {
      schema: "public",
      views: ["active_users"],
      excludeViews: [],
      verbose: false,
    });

    expect(sql).toContain("-- No differences found.");
    expect(sql).not.toContain("CREATE OR REPLACE VIEW");
    expect(sql).not.toContain("DROP VIEW");
  });

  it("creates views that exist only in source", async () => {
    const sourcePool = createMockPool([baseView]);
    const destPool = createMockPool([]);

    const sql = await generatePgViewsDiffSql(sourcePool, destPool, {
      schema: "public",
      views: ["active_users"],
      excludeViews: [],
      verbose: false,
    });

    expect(sql).toContain('CREATE OR REPLACE VIEW "public"."active_users" AS');
    expect(sql).toContain("WHERE users.active;");
    expect(sql).not.toContain("DROP VIEW");
  });

  it("drops views that exist only in destination", async () => {
    const sourcePool = createMockPool([]);
    const destPool = createMockPool([baseView]);

    const sql = await generatePgViewsDiffSql(sourcePool, destPool, {
      schema: "public",
      views: ["active_users"],
      excludeViews: [],
      verbose: false,
    });

    expect(sql).toContain('DROP VIEW IF EXISTS "public"."active_users";');
    expect(sql).not.toContain("CREATE OR REPLACE VIEW");
  });

  it("replaces changed regular views without dropping them first", async () => {
    const changedSource = {
      ...baseView,
      viewDefinition:
        " SELECT users.id, users.email\n   FROM users\n  WHERE users.active AND users.email IS NOT NULL;",
    };
    const sourcePool = createMockPool([changedSource]);
    const destPool = createMockPool([baseView]);

    const sql = await generatePgViewsDiffSql(sourcePool, destPool, {
      schema: "public",
      views: ["active_users"],
      excludeViews: [],
      verbose: false,
    });

    expect(sql).toContain('CREATE OR REPLACE VIEW "public"."active_users" AS');
    expect(sql).toContain("users.email IS NOT NULL;");
    expect(sql).not.toContain("DROP VIEW");
  });

  it("drops and recreates changed materialized views", async () => {
    const sourceMatView: PgViewInfo = {
      viewSchema: "public",
      viewName: "user_totals",
      viewType: "materialized_view",
      viewDefinition: " SELECT count(*) AS count\n   FROM users;",
    };
    const destMatView: PgViewInfo = {
      ...sourceMatView,
      viewDefinition: " SELECT count(*) AS count\n   FROM old_users;",
    };
    const sourcePool = createMockPool([sourceMatView]);
    const destPool = createMockPool([destMatView]);

    const sql = await generatePgViewsDiffSql(sourcePool, destPool, {
      schema: "public",
      views: ["user_totals"],
      excludeViews: [],
      verbose: false,
    });

    expect(sql).toContain(
      'DROP MATERIALIZED VIEW IF EXISTS "public"."user_totals";',
    );
    expect(sql).toContain('CREATE MATERIALIZED VIEW "public"."user_totals" AS');
  });
});

function createMockPool(views: PgViewInfo[]): Pool {
  const client = {
    query: async (_sql: string, params: unknown[]) => {
      if (params.length === 1) {
        return {
          rows: views.map((view) => ({
            view_name: view.viewName,
          })),
        };
      }

      const viewName = params[1];
      const view = views.find((candidate) => candidate.viewName === viewName);
      if (!view) {
        return { rows: [] };
      }

      return {
        rows: [
          {
            view_schema: view.viewSchema,
            view_name: view.viewName,
            view_type: view.viewType,
            view_definition: view.viewDefinition,
          },
        ],
      };
    },
    release: () => undefined,
  };

  return {
    connect: async () => client,
  } as unknown as Pool;
}
