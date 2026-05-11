import { describe, it, expect } from "vitest";
import {
  quoteIdentifier,
  quoteQualifiedTable,
  validateIdentifier,
} from "../../src/shared/identifiers";

describe("quoteIdentifier", () => {
  it("wraps identifier in double quotes", () => {
    expect(quoteIdentifier("my_table")).toBe('"my_table"');
  });

  it("doubles embedded double quotes", () => {
    expect(quoteIdentifier('my"table')).toBe('"my""table"');
  });

  it("handles identifiers with spaces", () => {
    expect(quoteIdentifier("my table")).toBe('"my table"');
  });

  it("handles empty string", () => {
    expect(quoteIdentifier("")).toBe('""');
  });

  it("handles identifiers with multiple embedded quotes", () => {
    expect(quoteIdentifier('a"b"c')).toBe('"a""b""c"');
  });
});

describe("quoteQualifiedTable", () => {
  it("produces schema.table format", () => {
    expect(quoteQualifiedTable("public", "my_table")).toBe(
      '"public"."my_table"',
    );
  });

  it("handles special chars in schema and table", () => {
    expect(quoteQualifiedTable('my"schema', 'my"table')).toBe(
      '"my""schema"."my""table"',
    );
  });
});

describe("validateIdentifier", () => {
  it("accepts normal identifiers", () => {
    expect(() => validateIdentifier("my_table", "test")).not.toThrow();
    expect(() =>
      validateIdentifier("directus_collections", "test"),
    ).not.toThrow();
    expect(() => validateIdentifier("MyTable", "test")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateIdentifier("", "test")).toThrow();
  });

  it("rejects identifier longer than 63 characters", () => {
    const longName = "a".repeat(64);
    expect(() => validateIdentifier(longName, "test")).toThrow();
  });

  it("accepts identifier of exactly 63 characters", () => {
    const maxName = "a".repeat(63);
    expect(() => validateIdentifier(maxName, "test")).not.toThrow();
  });
});
