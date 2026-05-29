import { type Pool } from "pg";
import {
  fetchPgViews,
  resolvePgViewPatterns,
  type PgViewInfo,
} from "../db/pg-views";
import { quoteIdentifier } from "../shared/identifiers";

export interface GeneratePgViewsDiffOptions {
  schema: string;
  views: string[];
  excludeViews: string[];
  verbose: boolean;
  onProgress?: (message: string) => void;
  onVerboseProgress?: (message: string) => void;
}

interface PgViewDiffWork {
  viewsToDrop: PgViewInfo[];
  viewsToCreate: PgViewInfo[];
}

export async function generatePgViewsDiffSql(
  sourcePool: Pool,
  destPool: Pool,
  options: GeneratePgViewsDiffOptions,
): Promise<string> {
  reportProgress(
    options.onProgress,
    "PostgreSQL views: resolving view patterns",
  );

  const { views } = await resolvePgViewPatterns(
    sourcePool,
    destPool,
    options.schema,
    options.views,
    options.excludeViews,
  );

  reportProgress(
    options.onProgress,
    `PostgreSQL views: comparing ${views.length} view(s)`,
  );

  const sourceClient = await sourcePool.connect();
  const destClient = await destPool.connect();

  let sql = `-- PostgreSQL Views Diff\n`;
  sql += `-- Generated automatically\n\n`;

  try {
    reportProgress(
      options.onProgress,
      "PostgreSQL views: fetching view definitions from source",
    );

    const sourceViews = await fetchPgViews(sourceClient, options.schema, views, {
      onViewStart: (viewName, viewPosition, totalViews) => {
        reportProgress(
          options.onProgress,
          `[pg-views source ${viewPosition}/${totalViews}] ${options.schema}.${viewName}: fetching definition`,
        );
      },
    });

    reportProgress(
      options.onProgress,
      "PostgreSQL views: fetching view definitions from destination",
    );

    const destViews = await fetchPgViews(destClient, options.schema, views, {
      onViewStart: (viewName, viewPosition, totalViews) => {
        reportProgress(
          options.onProgress,
          `[pg-views dest ${viewPosition}/${totalViews}] ${options.schema}.${viewName}: fetching definition`,
        );
      },
    });

    const sourceViewsMap = new Map(
      sourceViews.map((view) => [view.viewName, view]),
    );
    const destViewsMap = new Map(
      destViews.map((view) => [view.viewName, view]),
    );
    const work = buildPgViewDiffWork(
      views,
      sourceViewsMap,
      destViewsMap,
      options,
    );

    if (work.viewsToDrop.length === 0 && work.viewsToCreate.length === 0) {
      reportProgress(
        options.onProgress,
        "PostgreSQL views: no differences found",
      );
      sql += `-- No differences found.\n`;
      return sql;
    }

    reportProgress(
      options.onProgress,
      "PostgreSQL views: generating SQL script",
    );

    if (work.viewsToDrop.length > 0) {
      sql += `-- Drop removed or incompatible views\n`;
      for (const view of work.viewsToDrop) {
        sql += `${buildDropViewStatement(view)}\n`;
      }
      sql += `\n`;
    }

    if (work.viewsToCreate.length > 0) {
      sql += `-- Create or replace source views\n`;
      for (const view of work.viewsToCreate) {
        sql += `${buildCreateViewStatement(view)}\n\n`;
      }
    }
  } finally {
    sourceClient.release();
    destClient.release();
  }

  return sql;
}

function buildPgViewDiffWork(
  views: string[],
  sourceViewsMap: Map<string, PgViewInfo>,
  destViewsMap: Map<string, PgViewInfo>,
  options: GeneratePgViewsDiffOptions,
): PgViewDiffWork {
  const viewsToDrop: PgViewInfo[] = [];
  const viewsToCreate: PgViewInfo[] = [];

  for (const [viewIndex, viewName] of views.entries()) {
    const progressLabel = formatPgViewsProgressLabel(
      viewIndex + 1,
      views.length,
      options.schema,
      viewName,
    );
    const sourceView = sourceViewsMap.get(viewName);
    const destView = destViewsMap.get(viewName);

    reportProgress(options.onProgress, `${progressLabel}: comparing view`);

    if (sourceView && !destView) {
      viewsToCreate.push(sourceView);
      reportProgress(options.onProgress, `${progressLabel}: view to create`);
      continue;
    }

    if (!sourceView && destView) {
      viewsToDrop.push(destView);
      reportProgress(options.onProgress, `${progressLabel}: view to drop`);
      continue;
    }

    if (!sourceView || !destView) {
      reportProgress(options.onProgress, `${progressLabel}: no view metadata`);
      continue;
    }

    if (pgViewsAreEqual(sourceView, destView)) {
      reportProgress(options.onProgress, `${progressLabel}: no changes`);
      continue;
    }

    if (requiresDropBeforeCreate(sourceView, destView)) {
      viewsToDrop.push(destView);
    }

    viewsToCreate.push(sourceView);
    reportProgress(
      options.onProgress,
      `${progressLabel}: view definition changed`,
    );
  }

  return { viewsToDrop, viewsToCreate };
}

function pgViewsAreEqual(sourceView: PgViewInfo, destView: PgViewInfo): boolean {
  if (sourceView.viewType !== destView.viewType) {
    return false;
  }

  return (
    normalizeViewDefinition(sourceView.viewDefinition) ===
    normalizeViewDefinition(destView.viewDefinition)
  );
}

function requiresDropBeforeCreate(
  sourceView: PgViewInfo,
  destView: PgViewInfo,
): boolean {
  if (sourceView.viewType !== destView.viewType) {
    return true;
  }

  return sourceView.viewType === "materialized_view";
}

function buildDropViewStatement(view: PgViewInfo): string {
  return `DROP ${buildViewObjectKeyword(view)} IF EXISTS ${quoteQualifiedView(view)};`;
}

function buildCreateViewStatement(view: PgViewInfo): string {
  const definition = normalizeViewDefinition(view.viewDefinition);
  if (view.viewType === "materialized_view") {
    return `CREATE MATERIALIZED VIEW ${quoteQualifiedView(view)} AS\n${definition};`;
  }

  return `CREATE OR REPLACE VIEW ${quoteQualifiedView(view)} AS\n${definition};`;
}

function buildViewObjectKeyword(view: PgViewInfo): string {
  if (view.viewType === "materialized_view") {
    return "MATERIALIZED VIEW";
  }

  return "VIEW";
}

function quoteQualifiedView(view: PgViewInfo): string {
  return `${quoteIdentifier(view.viewSchema)}.${quoteIdentifier(view.viewName)}`;
}

function normalizeViewDefinition(definition: string): string {
  return definition.trim().replace(/;+$/, "").trim();
}

function formatPgViewsProgressLabel(
  viewPosition: number,
  totalViews: number,
  schema: string,
  viewName: string,
): string {
  return `[pg-views ${viewPosition}/${totalViews}] ${schema}.${viewName}`;
}

function reportProgress(
  callback: ((message: string) => void) | undefined,
  message: string,
): void {
  if (callback) {
    callback(message);
  }
}
