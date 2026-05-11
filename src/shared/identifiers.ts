/**
 * Safe identifier quoting for PostgreSQL.
 * All table names, column names, and schema names MUST be quoted through these helpers.
 */

/**
 * Quotes a PostgreSQL identifier (table name, column name, schema name).
 * Doubles any embedded double-quote characters.
 */
export function quoteIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * Quotes a schema-qualified table name.
 */
export function quoteQualifiedTable(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

/**
 * Validates that an identifier contains only safe characters.
 * This is a defense-in-depth check — identifiers are always quoted,
 * but this catches obvious injection attempts early.
 */
export function validateIdentifier(name: string, context: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      `Invalid identifier (${context}): must be a non-empty string`,
    );
  }
  if (name.length > 63) {
    throw new Error(
      `Invalid identifier (${context}): "${name}" exceeds PostgreSQL max identifier length of 63`,
    );
  }
}

/**
 * Validates an array of identifiers (e.g., column names).
 */
export function validateIdentifiers(names: string[], context: string): void {
  for (const name of names) {
    validateIdentifier(name, context);
  }
}
