import { describe, it, expect } from "vitest";
import {
  serializeValue,
  deserializeValue,
  valuesAreEqual,
} from "../../src/diff/serialize-value";

describe("serializeValue", () => {
  it("serializes null to null", () => {
    expect(serializeValue(null)).toBeNull();
    expect(serializeValue(undefined)).toBeNull();
  });

  it("serializes Buffer as bytea object with base64", () => {
    const buf = Buffer.from("hello world");
    const result = serializeValue(buf) as { $type: string; $value: string };
    expect(result.$type).toBe("bytea");
    expect(result.$value).toBe(buf.toString("base64"));
  });

  it("serializes Date as ISO string", () => {
    const date = new Date("2026-05-11T12:00:00.000Z");
    expect(serializeValue(date)).toBe("2026-05-11T12:00:00.000Z");
  });

  it("serializes date columns as PostgreSQL date literals", () => {
    const date = new Date(2026, 4, 11, 0, 0, 0, 0);
    expect(serializeValue(date, "date")).toBe("2026-05-11");
  });

  it("serializes timestamp without time zone columns without UTC conversion", () => {
    const date = new Date(2026, 4, 11, 12, 34, 56, 789);
    expect(serializeValue(date, "timestamp without time zone")).toBe(
      "2026-05-11 12:34:56.789",
    );
  });

  it("serializes BigInt as string", () => {
    // BigInt literals preserve exact precision
    expect(serializeValue(12345678901234567890n)).toBe("12345678901234567890");
  });

  it("preserves strings as-is", () => {
    expect(serializeValue("hello")).toBe("hello");
  });

  it("preserves numbers as-is", () => {
    expect(serializeValue(42)).toBe(42);
    expect(serializeValue(3.14)).toBe(3.14);
  });

  it("preserves booleans as-is", () => {
    expect(serializeValue(true)).toBe(true);
    expect(serializeValue(false)).toBe(false);
  });

  it("serializes arrays recursively", () => {
    const result = serializeValue([1, "two", null]);
    expect(result).toEqual([1, "two", null]);
  });

  it("serializes arrays with buffers", () => {
    const buf = Buffer.from("test");
    const result = serializeValue([buf]) as Array<{
      $type: string;
      $value: string;
    }>;
    expect(result[0].$type).toBe("bytea");
  });

  it("serializes objects as plain objects", () => {
    const obj = { a: 1, b: "hello" };
    expect(serializeValue(obj)).toEqual({ a: 1, b: "hello" });
  });
});

describe("deserializeValue", () => {
  it("deserializes null to null", () => {
    expect(deserializeValue(null)).toBeNull();
    expect(deserializeValue(undefined)).toBeNull();
  });

  it("deserializes bytea object back to Buffer", () => {
    const original = Buffer.from("hello world");
    const serialized = { $type: "bytea", $value: original.toString("base64") };
    const result = deserializeValue(serialized);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect((result as Buffer).toString()).toBe("hello world");
  });

  it("preserves strings", () => {
    expect(deserializeValue("hello")).toBe("hello");
  });

  it("preserves numbers", () => {
    expect(deserializeValue(42)).toBe(42);
  });

  it("deserializes arrays recursively", () => {
    const buf = Buffer.from("test");
    const serialized = [{ $type: "bytea", $value: buf.toString("base64") }];
    const result = deserializeValue(serialized) as Buffer[];
    expect(Buffer.isBuffer(result[0])).toBe(true);
  });
});

describe("valuesAreEqual", () => {
  it("null equals null", () => {
    expect(valuesAreEqual(null, null)).toBe(true);
  });

  it("null does not equal non-null", () => {
    expect(valuesAreEqual(null, "value")).toBe(false);
    expect(valuesAreEqual("value", null)).toBe(false);
  });

  it("equal primitives are equal", () => {
    expect(valuesAreEqual(42, 42)).toBe(true);
    expect(valuesAreEqual("hello", "hello")).toBe(true);
    expect(valuesAreEqual(true, true)).toBe(true);
  });

  it("different primitives are not equal", () => {
    expect(valuesAreEqual(42, 43)).toBe(false);
    expect(valuesAreEqual("hello", "world")).toBe(false);
  });

  it("JSON objects with same keys/values are equal regardless of key order", () => {
    const a = { z: 1, a: 2 };
    const b = { a: 2, z: 1 };
    expect(valuesAreEqual(a, b)).toBe(true);
  });

  it("JSON objects with different values are not equal", () => {
    const a = { a: 1 };
    const b = { a: 2 };
    expect(valuesAreEqual(a, b)).toBe(false);
  });

  it("arrays with same elements are equal", () => {
    expect(valuesAreEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it("arrays with different elements are not equal", () => {
    expect(valuesAreEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(valuesAreEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("bytea objects compare by base64 value", () => {
    const a = { $type: "bytea", $value: "aGVsbG8=" };
    const b = { $type: "bytea", $value: "aGVsbG8=" };
    const c = { $type: "bytea", $value: "d29ybGQ=" };
    expect(valuesAreEqual(a, b)).toBe(true);
    expect(valuesAreEqual(a, c)).toBe(false);
  });

  it("nested JSON objects are compared structurally", () => {
    const a = { x: { y: 1 } };
    const b = { x: { y: 1 } };
    const c = { x: { y: 2 } };
    expect(valuesAreEqual(a, b)).toBe(true);
    expect(valuesAreEqual(a, c)).toBe(false);
  });
});
