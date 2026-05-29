import { Pool } from "pg";
import {
  fetchTableMetadata,
  listTables,
  type ColumnInfo,
  type TableMetadata,
} from "../db/metadata";
import {
  type SchemaColumnChange,
  type SchemaColumnDefinition,
  type SchemaDiffJson,
  type SchemaPrimaryKeyChange,
  type SchemaTableDiff,
} from "./schema-diff-schema";
import {
  quoteIdentifier,
  validateIdentifier,
  validateIdentifiers,
} from "../shared/identifiers";

export interface GenerateSchemaDiffOptions {
  schema: string;
  tables: string[];
  excludeTables: string[];
  verbose: boolean;
  onProgress?: (message: string) => void;
  onVerboseProgress?: (message: string) => void;
}

export async function generateSchemaDiff(
  sourcePool: Pool,
  destPool: Pool,
  options: GenerateSchemaDiffOptions,
): Promise<SchemaDiffJson> {
  const sourceClient = await sourcePool.connect();
  const destClient = await destPool.connect();

  const tableDiffs: SchemaTableDiff[] = [];
  const summary = {
    tablesCompared: 0,
    tablesToCreate: 0,
    tablesToDrop: 0,
    columnsToAdd: 0,
    columnsToAlter: 0,
    columnsToDrop: 0,
    primaryKeysToChange: 0,
  };

  try {
    const [sourceTables, destTables] = await Promise.all([
      listTables(sourceClient, options.schema),
      listTables(destClient, options.schema),
    ]);
    const sourceTableSet = new Set(sourceTables);
    const destTableSet = new Set(destTables);

    for (const [tableIndex, table] of options.tables.entries()) {
      const progressLabel = formatSchemaProgressLabel(
        tableIndex + 1,
        options.tables.length,
        options.schema,
        table,
      );

      if (options.excludeTables.includes(table)) {
        reportVerboseProgress(
          options,
          `${progressLabel}: skipping excluded schema diff table`,
        );
        continue;
      }

      validateIdentifier(table, "schema diff table name");
      summary.tablesCompared++;

      reportProgress(
        options.onProgress,
        `${progressLabel}: loading table metadata`,
      );

      const sourceExists = sourceTableSet.has(table);
      const destExists = destTableSet.has(table);

      reportVerboseProgress(
        options,
        `${progressLabel}: source exists ${sourceExists}, destination exists ${destExists}`,
      );

      const [sourceMeta, destMeta] = await Promise.all([
        sourceExists
          ? fetchTableMetadata(sourceClient, options.schema, table)
          : Promise.resolve(undefined),
        destExists
          ? fetchTableMetadata(destClient, options.schema, table)
          : Promise.resolve(undefined),
      ]);

      const tableDiff = buildSchemaTableDiff(
        options.schema,
        table,
        sourceMeta,
        destMeta,
      );

      reportProgress(
        options.onProgress,
        `${progressLabel}: ${summarizeSchemaTableDiff(tableDiff)}`,
      );

      if (!tableDiff) {
        continue;
      }

      if (tableDiff.createTable) {
        summary.tablesToCreate++;
      }
      if (tableDiff.dropTable) {
        summary.tablesToDrop++;
      }
      summary.columnsToAdd += tableDiff.addColumns.length;
      summary.columnsToAlter += tableDiff.alterColumns.length;
      summary.columnsToDrop += tableDiff.dropColumns.length;
      if (tableDiff.primaryKeyChange) {
        summary.primaryKeysToChange++;
      }

      tableDiffs.push(tableDiff);
    }
  } finally {
    sourceClient.release();
    destClient.release();
  }

  return {
    format: "frg-schema-diff-json/v1",
    generatedAt: new Date().toISOString(),
    source: { schema: options.schema },
    dest: { schema: options.schema },
    options: {
      tables: options.tables,
      excludedTables: options.excludeTables,
    },
    tables: tableDiffs,
    summary,
  };
}

function buildSchemaTableDiff(
  schema: string,
  table: string,
  sourceMeta: TableMetadata | undefined,
  destMeta: TableMetadata | undefined,
): SchemaTableDiff | null {
  if (sourceMeta && !destMeta) {
    return {
      table,
      schema,
      sourceExists: true,
      destExists: false,
      createTable: {
        columns: sourceMeta.columns.map(buildSchemaColumnDefinition),
        primaryKey: [...sourceMeta.primaryKey],
      },
      dropTable: false,
      addColumns: [],
      alterColumns: [],
      dropColumns: [],
      primaryKeyChange: null,
    };
  }

  if (!sourceMeta && destMeta) {
    return {
      table,
      schema,
      sourceExists: false,
      destExists: true,
      createTable: null,
      dropTable: true,
      addColumns: [],
      alterColumns: [],
      dropColumns: [],
      primaryKeyChange: null,
    };
  }

  if (!sourceMeta || !destMeta) {
    return null;
  }

  const sourceColumns = new Map(
    sourceMeta.columns.map((column) => [column.columnName, column]),
  );
  const destColumns = new Map(
    destMeta.columns.map((column) => [column.columnName, column]),
  );

  const addColumns = sourceMeta.columns
    .filter((column) => !destColumns.has(column.columnName))
    .map(buildSchemaColumnDefinition);

  const dropColumns = destMeta.columns
    .filter((column) => !sourceColumns.has(column.columnName))
    .map(buildSchemaColumnDefinition);

  const alterColumns: SchemaColumnChange[] = [];
  for (const sourceColumn of sourceMeta.columns) {
    const destColumn = destColumns.get(sourceColumn.columnName);
    if (!destColumn) {
      continue;
    }

    const from = buildSchemaColumnDefinition(destColumn);
    const to = buildSchemaColumnDefinition(sourceColumn);
    if (!schemaColumnsAreEqual(from, to)) {
      alterColumns.push({
        column: sourceColumn.columnName,
        from,
        to,
      });
    }
  }

  const primaryKeyChange = buildPrimaryKeyChange(sourceMeta, destMeta);
  const hasChanges =
    addColumns.length > 0 ||
    alterColumns.length > 0 ||
    dropColumns.length > 0 ||
    primaryKeyChange !== null;

  if (!hasChanges) {
    return null;
  }

  return {
    table,
    schema,
    sourceExists: true,
    destExists: true,
    createTable: null,
    dropTable: false,
    addColumns,
    alterColumns,
    dropColumns,
    primaryKeyChange,
  };
}

function buildPrimaryKeyChange(
  sourceMeta: TableMetadata,
  destMeta: TableMetadata,
): SchemaPrimaryKeyChange | null {
  if (arraysEqual(sourceMeta.primaryKey, destMeta.primaryKey)) {
    return null;
  }

  validateIdentifiers(sourceMeta.primaryKey, "source primary key column");
  validateIdentifiers(destMeta.primaryKey, "destination primary key column");

  return {
    from: [...destMeta.primaryKey],
    to: [...sourceMeta.primaryKey],
    dropConstraintName: destMeta.primaryKeyConstraintName,
  };
}

function buildSchemaColumnDefinition(
  column: ColumnInfo,
): SchemaColumnDefinition {
  return {
    name: column.columnName,
    type: buildColumnTypeSql(column),
    nullable: column.isNullable,
    default: normalizeColumnDefault(column),
    isGenerated: column.isGenerated,
    generationExpression: column.generationExpression,
    ordinalPosition: column.ordinalPosition,
  };
}

function normalizeColumnDefault(column: ColumnInfo): string | null {
  if (column.isGenerated) {
    return null;
  }
  return column.columnDefault;
}

function formatSchemaProgressLabel(
  tablePosition: number,
  totalTables: number,
  schema: string,
  table: string,
): string {
  return `[schema ${tablePosition}/${totalTables}] ${schema}.${table}`;
}

function summarizeSchemaTableDiff(tableDiff: SchemaTableDiff | null): string {
  if (!tableDiff) {
    return "no schema changes";
  }

  const changeDescriptions: string[] = [];

  if (tableDiff.createTable) {
    changeDescriptions.push("create table");
  }

  if (tableDiff.dropTable) {
    changeDescriptions.push("drop table");
  }

  if (tableDiff.addColumns.length > 0) {
    changeDescriptions.push(`${tableDiff.addColumns.length} column(s) to add`);
  }

  if (tableDiff.alterColumns.length > 0) {
    changeDescriptions.push(
      `${tableDiff.alterColumns.length} column(s) to alter`,
    );
  }

  if (tableDiff.dropColumns.length > 0) {
    changeDescriptions.push(
      `${tableDiff.dropColumns.length} column(s) to drop`,
    );
  }

  if (tableDiff.primaryKeyChange) {
    changeDescriptions.push("primary key change");
  }

  return changeDescriptions.join(", ");
}

function reportProgress(
  callback: ((message: string) => void) | undefined,
  message: string,
): void {
  if (callback) {
    callback(message);
  }
}

function reportVerboseProgress(
  options: Pick<GenerateSchemaDiffOptions, "verbose" | "onVerboseProgress">,
  message: string,
): void {
  if (!options.verbose) {
    return;
  }

  if (options.onVerboseProgress) {
    options.onVerboseProgress(message);
    return;
  }

  console.log(message);
}

function buildColumnTypeSql(column: ColumnInfo): string {
  if (column.domainName) {
    return qualifyTypeName(column.domainSchema, column.domainName);
  }

  if (column.dataType === "ARRAY") {
    const elementType = buildArrayElementTypeSql(column);
    return `${elementType}[]`;
  }

  if (column.dataType === "character varying") {
    return column.characterMaximumLength
      ? `character varying(${column.characterMaximumLength})`
      : "character varying";
  }

  if (column.dataType === "character") {
    return column.characterMaximumLength
      ? `character(${column.characterMaximumLength})`
      : "character";
  }

  if (column.dataType === "numeric") {
    if (column.numericPrecision !== null && column.numericScale !== null) {
      return `numeric(${column.numericPrecision}, ${column.numericScale})`;
    }
    if (column.numericPrecision !== null) {
      return `numeric(${column.numericPrecision})`;
    }
    return "numeric";
  }

  if (column.dataType === "time without time zone") {
    return withOptionalPrecision("time", column.datetimePrecision);
  }

  if (column.dataType === "time with time zone") {
    return withOptionalPrecision(
      "time with time zone",
      column.datetimePrecision,
    );
  }

  if (column.dataType === "timestamp without time zone") {
    return withOptionalPrecision("timestamp", column.datetimePrecision);
  }

  if (column.dataType === "timestamp with time zone") {
    return withOptionalPrecision(
      "timestamp with time zone",
      column.datetimePrecision,
    );
  }

  if (column.dataType === "interval") {
    let typeSql = "interval";
    if (column.intervalType) {
      typeSql += ` ${column.intervalType}`;
    }
    if (column.intervalPrecision !== null) {
      typeSql += `(${column.intervalPrecision})`;
    }
    return typeSql;
  }

  if (column.dataType === "USER-DEFINED") {
    return qualifyTypeName(column.udtSchema, column.udtName);
  }

  return column.dataType;
}

function buildArrayElementTypeSql(column: ColumnInfo): string {
  const elementTypeName = column.udtName.startsWith("_")
    ? column.udtName.slice(1)
    : column.udtName;

  if (column.udtSchema !== "pg_catalog") {
    return qualifyTypeName(column.udtSchema, elementTypeName);
  }

  return mapPgCatalogTypeName(elementTypeName);
}

function qualifyTypeName(schema: string | null, typeName: string): string {
  validateIdentifier(typeName, "type name");
  if (!schema || schema === "pg_catalog") {
    return quoteIdentifier(typeName);
  }

  validateIdentifier(schema, "type schema name");
  return `${quoteIdentifier(schema)}.${quoteIdentifier(typeName)}`;
}

function withOptionalPrecision(
  typeName: string,
  precision: number | null,
): string {
  if (precision === null) {
    return typeName;
  }
  return `${typeName}(${precision})`;
}

function mapPgCatalogTypeName(typeName: string): string {
  switch (typeName) {
    case "int2":
      return "smallint";
    case "int4":
      return "integer";
    case "int8":
      return "bigint";
    case "float4":
      return "real";
    case "float8":
      return "double precision";
    case "bool":
      return "boolean";
    case "varchar":
      return "character varying";
    case "bpchar":
      return "character";
    case "timestamptz":
      return "timestamp with time zone";
    case "timestamp":
      return "timestamp";
    case "timetz":
      return "time with time zone";
    case "time":
      return "time";
    default:
      return quoteIdentifier(typeName);
  }
}

function schemaColumnsAreEqual(
  left: SchemaColumnDefinition,
  right: SchemaColumnDefinition,
): boolean {
  return (
    left.type === right.type &&
    left.nullable === right.nullable &&
    left.default === right.default &&
    left.isGenerated === right.isGenerated &&
    left.generationExpression === right.generationExpression
  );
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}
