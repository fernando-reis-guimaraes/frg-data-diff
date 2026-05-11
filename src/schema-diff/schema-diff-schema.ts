import { z } from "zod";

const schemaColumnDefinitionSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  default: z.string().nullable(),
  isGenerated: z.boolean(),
  generationExpression: z.string().nullable(),
  ordinalPosition: z.number().int(),
});

const schemaColumnChangeSchema = z.object({
  column: z.string(),
  from: schemaColumnDefinitionSchema,
  to: schemaColumnDefinitionSchema,
});

const schemaCreateTableSchema = z.object({
  columns: z.array(schemaColumnDefinitionSchema),
  primaryKey: z.array(z.string()),
});

const schemaPrimaryKeyChangeSchema = z.object({
  from: z.array(z.string()),
  to: z.array(z.string()),
  dropConstraintName: z.string().nullable(),
});

const schemaTableDiffSchema = z.object({
  table: z.string(),
  schema: z.string(),
  sourceExists: z.boolean(),
  destExists: z.boolean(),
  createTable: schemaCreateTableSchema.nullable(),
  dropTable: z.boolean(),
  addColumns: z.array(schemaColumnDefinitionSchema),
  alterColumns: z.array(schemaColumnChangeSchema),
  dropColumns: z.array(schemaColumnDefinitionSchema),
  primaryKeyChange: schemaPrimaryKeyChangeSchema.nullable(),
});

const schemaDiffSummarySchema = z.object({
  tablesCompared: z.number().int(),
  tablesToCreate: z.number().int(),
  tablesToDrop: z.number().int(),
  columnsToAdd: z.number().int(),
  columnsToAlter: z.number().int(),
  columnsToDrop: z.number().int(),
  primaryKeysToChange: z.number().int(),
});

export const schemaDiffJsonSchema = z.object({
  format: z.literal("postgres-schema-diff-json/v1"),
  generatedAt: z.string(),
  source: z.object({ schema: z.string() }),
  dest: z.object({ schema: z.string() }),
  options: z.object({
    tables: z.array(z.string()),
    excludedTables: z.array(z.string()),
  }),
  tables: z.array(schemaTableDiffSchema),
  summary: schemaDiffSummarySchema,
});

export type SchemaColumnDefinition = z.infer<
  typeof schemaColumnDefinitionSchema
>;
export type SchemaColumnChange = z.infer<typeof schemaColumnChangeSchema>;
export type SchemaCreateTable = z.infer<typeof schemaCreateTableSchema>;
export type SchemaPrimaryKeyChange = z.infer<
  typeof schemaPrimaryKeyChangeSchema
>;
export type SchemaTableDiff = z.infer<typeof schemaTableDiffSchema>;
export type SchemaDiffJson = z.infer<typeof schemaDiffJsonSchema>;

export function validateSchemaDiffJson(data: unknown): SchemaDiffJson {
  const result = schemaDiffJsonSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      "Invalid schema diff JSON format:\n" +
        JSON.stringify(result.error.format(), null, 2),
    );
  }
  return result.data;
}
