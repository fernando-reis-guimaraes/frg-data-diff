import { z } from "zod";

// Individual diff change record
const changeValueSchema = z.object({
  from: z.unknown(),
  to: z.unknown(),
});

const updateRecordSchema = z.object({
  pk: z.record(z.unknown()),
  changes: z.record(changeValueSchema),
  guard: z.record(z.unknown()),
});

const insertRecordSchema = z.object({
  row: z.record(z.unknown()),
});

const deleteRecordSchema = z.object({
  pk: z.record(z.unknown()),
  guard: z.record(z.unknown()),
});

const tableDiffSchema = z.object({
  schema: z.string(),
  table: z.string(),
  primaryKey: z.array(z.string()),
  columnTypes: z.record(z.string()).optional(),
  updates: z.array(updateRecordSchema),
  inserts: z.array(insertRecordSchema),
  deletes: z.array(deleteRecordSchema),
});

const diffOptionsSchema = z.object({
  includeDeletes: z.boolean(),
  ignoredColumns: z.array(z.string()),
});

const diffSourceDestSchema = z.object({
  schema: z.string(),
});

const diffSummarySchema = z.object({
  tablesCompared: z.number().int(),
  updates: z.number().int(),
  inserts: z.number().int(),
  deletes: z.number().int(),
  skippedTables: z.array(z.string()),
});

export const diffJsonSchema = z.object({
  format: z.literal("postgres-data-diff-json/v1"),
  generatedAt: z.string(),
  source: diffSourceDestSchema,
  dest: diffSourceDestSchema,
  options: diffOptionsSchema,
  tables: z.array(tableDiffSchema),
  summary: diffSummarySchema,
});

export type DiffJson = z.infer<typeof diffJsonSchema>;
export type TableDiff = z.infer<typeof tableDiffSchema>;
export type UpdateRecord = z.infer<typeof updateRecordSchema>;
export type InsertRecord = z.infer<typeof insertRecordSchema>;
export type DeleteRecord = z.infer<typeof deleteRecordSchema>;
export type ChangeValue = z.infer<typeof changeValueSchema>;

/**
 * Validates a diff JSON object against the schema.
 * Throws if invalid.
 */
export function validateDiffJson(data: unknown): DiffJson {
  const result = diffJsonSchema.safeParse(data);
  if (!result.success) {
    throw new Error(
      "Invalid diff JSON format:\n" +
        JSON.stringify(result.error.format(), null, 2),
    );
  }
  return result.data;
}
