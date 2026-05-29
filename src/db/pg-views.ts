import { type Pool, type PoolClient } from "pg";

export type PgViewType = "view" | "materialized_view";

export interface PgViewInfo {
  viewSchema: string;
  viewName: string;
  viewType: PgViewType;
  viewDefinition: string;
}

export interface FetchPgViewsOptions {
  onViewStart?: (
    viewName: string,
    viewPosition: number,
    totalViews: number,
  ) => void;
}

export interface ResolvedPgViewPatterns {
  views: string[];
  excludedViews: string[];
}

/**
 * Lists regular and materialized views in the given schema.
 */
export async function listPgViews(
  client: PoolClient,
  schema: string,
): Promise<string[]> {
  const result = await client.query<{ view_name: string }>(
    `
    SELECT cls.relname AS view_name
    FROM pg_class cls
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = $1
      AND cls.relkind IN ('v', 'm')
    ORDER BY cls.relname
    `,
    [schema],
  );

  return result.rows.map((row) => row.view_name);
}

export async function fetchPgView(
  client: PoolClient,
  schema: string,
  viewName: string,
): Promise<PgViewInfo | undefined> {
  const result = await client.query<{
    view_schema: string;
    view_name: string;
    view_type: PgViewType;
    view_definition: string;
  }>(
    `
    SELECT
      ns.nspname AS view_schema,
      cls.relname AS view_name,
      CASE cls.relkind
        WHEN 'm' THEN 'materialized_view'
        ELSE 'view'
      END AS view_type,
      pg_get_viewdef(cls.oid, true) AS view_definition
    FROM pg_class cls
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = $1
      AND cls.relname = $2
      AND cls.relkind IN ('v', 'm')
    `,
    [schema, viewName],
  );

  const row = result.rows[0];
  if (!row) {
    return undefined;
  }

  return {
    viewSchema: row.view_schema,
    viewName: row.view_name,
    viewType: row.view_type,
    viewDefinition: row.view_definition,
  };
}

export async function fetchPgViews(
  client: PoolClient,
  schema: string,
  views: string[],
  options: FetchPgViewsOptions = {},
): Promise<PgViewInfo[]> {
  const results: PgViewInfo[] = [];

  for (const [viewIndex, viewName] of views.entries()) {
    if (options.onViewStart) {
      options.onViewStart(viewName, viewIndex + 1, views.length);
    }

    const view = await fetchPgView(client, schema, viewName);
    if (view) {
      results.push(view);
    }
  }

  return results;
}

export async function resolvePgViewPatterns(
  sourcePool: Pool,
  destPool: Pool,
  schema: string,
  includePatterns: string[],
  excludePatterns: string[],
): Promise<ResolvedPgViewPatterns> {
  const [sourceClient, destClient] = await Promise.all([
    sourcePool.connect(),
    destPool.connect(),
  ]);

  try {
    const [sourceViews, destViews] = await Promise.all([
      listPgViews(sourceClient, schema),
      listPgViews(destClient, schema),
    ]);

    return resolvePgViewPatternsFromViewLists(
      sourceViews,
      destViews,
      includePatterns,
      excludePatterns,
    );
  } finally {
    sourceClient.release();
    destClient.release();
  }
}

export function resolvePgViewPatternsFromViewLists(
  sourceViews: string[],
  destViews: string[],
  includePatterns: string[],
  excludePatterns: string[],
): ResolvedPgViewPatterns {
  const sourceSet = new Set(sourceViews);
  const destSet = new Set(destViews);
  const availableViews = Array.from(
    new Set([...sourceViews, ...destViews]),
  ).sort();
  let requestedPatterns = includePatterns;
  if (requestedPatterns.length === 0) {
    requestedPatterns = ["*"];
  }
  const resolvedViews: string[] = [];

  for (const pattern of requestedPatterns) {
    const matches = resolvePattern(pattern, availableViews);
    if (matches.length > 0) {
      addUniqueMatches(resolvedViews, matches);
      continue;
    }

    if (hasWildcard(pattern)) {
      if (availableViews.length === 0 || pattern === "*") {
        continue;
      }

      throw new Error(`View pattern "${pattern}" matched no views.`);
    }

    const missingFrom: string[] = [];
    if (!sourceSet.has(pattern)) {
      missingFrom.push("source");
    }
    if (!destSet.has(pattern)) {
      missingFrom.push("destination");
    }

    throw new Error(
      `View "${pattern}" was not found in the ${missingFrom.join(" and ")} database.`,
    );
  }

  const excludedViews = Array.from(
    new Set(
      excludePatterns.flatMap((pattern) =>
        resolvePattern(pattern, resolvedViews),
      ),
    ),
  );

  const views = resolvedViews.filter((view) => !excludedViews.includes(view));
  return { views, excludedViews };
}

function addUniqueMatches(values: string[], matches: string[]): void {
  for (const match of matches) {
    if (!values.includes(match)) {
      values.push(match);
    }
  }
}

function resolvePattern(pattern: string, availableViews: string[]): string[] {
  if (!hasWildcard(pattern)) {
    if (availableViews.includes(pattern)) {
      return [pattern];
    }

    return [];
  }

  const matcher = buildWildcardRegex(pattern);
  return availableViews.filter((view) => matcher.test(view));
}

function hasWildcard(pattern: string): boolean {
  return pattern.includes("*");
}

function buildWildcardRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}
