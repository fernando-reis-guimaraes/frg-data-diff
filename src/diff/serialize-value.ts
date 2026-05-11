/**
 * Value serialization utilities for converting PostgreSQL values to/from
 * JSON-compatible representations in the diff file.
 */

/**
 * Serializes a PostgreSQL value for storage in the diff JSON file.
 * - Buffer (bytea) -> {$type:'bytea', $value: base64}
 * - pg geometric types (point, circle, lseg, line, box, path) -> string literals
 * - Date -> ISO 8601 string
 * - BigInt -> string (to preserve precision)
 * - null/undefined -> null
 * - Objects/arrays -> recursively serialized
 * - Everything else -> as-is
 *
 * @param value - The value to serialize
 * @param dataType - Optional PostgreSQL data type name to guide serialization of ambiguous types
 */
export function serializeValue(value: unknown, dataType?: string): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    // Encode bytea as base64 with a type tag
    return { $type: "bytea", $value: value.toString("base64") };
  }
  if (value instanceof Date) {
    return serializeDateValue(value, dataType);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  // pg returns numeric/decimal as strings - preserve as-is
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => serializeValue(v));
  }
  if (typeof value === "object") {
    // Handle pg geometric types which are returned as plain objects.
    // Use dataType to distinguish from jsonb objects that happen to have the same shape.
    if (dataType) {
      const geoStr = serializeGeometricValue(
        dataType,
        value as Record<string, unknown>,
      );
      if (geoStr !== null) return geoStr;

      // Serialize pg interval objects (returned as {years, months, days, hours, minutes, seconds, milliseconds})
      // as PostgreSQL interval literal strings so they can be passed back as parameters.
      if (dataType === "interval") {
        return serializeIntervalValue(value as Record<string, unknown>);
      }
    }
    // Serialize plain objects (jsonb, json, unknown objects)
    return JSON.parse(
      JSON.stringify(value, (_k, v) => {
        if (typeof v === "bigint") return v.toString();
        return v;
      }),
    );
  }
  return value;
}

function serializeDateValue(value: Date, dataType?: string): string {
  if (dataType === "date") {
    return [
      value.getFullYear(),
      pad2(value.getMonth() + 1),
      pad2(value.getDate()),
    ].join("-");
  }

  if (dataType === "timestamp without time zone") {
    const milliseconds = value.getMilliseconds();
    const fractional =
      milliseconds > 0 ? `.${String(milliseconds).padStart(3, "0")}` : "";
    return (
      `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())} ` +
      `${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}${fractional}`
    );
  }

  return value.toISOString();
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Attempts to serialize a known PostgreSQL geometric type to its string literal form.
 * Returns null if the dataType is not a known geometric type.
 *
 * PostgreSQL accepts these string forms as input for geometric types:
 *  point:   (x,y)
 *  circle:  <(x,y),r>
 *  lseg:    ((x1,y1),(x2,y2))
 *  box:     ((x1,y1),(x2,y2))
 *  line:    {a,b,c}
 *  path:    ((x1,y1),...) for closed, (x1,y1,...) for open
 */
function serializeGeometricValue(
  dataType: string,
  obj: Record<string, unknown>,
): string | null {
  switch (dataType) {
    case "point":
      if ("x" in obj && "y" in obj) {
        return `(${obj["x"]},${obj["y"]})`;
      }
      return null;
    case "circle":
      if ("x" in obj && "y" in obj && "radius" in obj) {
        return `<(${obj["x"]},${obj["y"]}),${obj["radius"]}>`;
      }
      return null;
    case "lseg":
    case "box":
      if ("x1" in obj && "y1" in obj && "x2" in obj && "y2" in obj) {
        return `((${obj["x1"]},${obj["y1"]}),(${obj["x2"]},${obj["y2"]}))`;
      }
      return null;
    case "line":
      if ("a" in obj && "b" in obj && "c" in obj) {
        return `{${obj["a"]},${obj["b"]},${obj["c"]}}`;
      }
      return null;
    case "path":
      if ("points" in obj && Array.isArray(obj["points"])) {
        const points = (obj["points"] as Array<{ x: unknown; y: unknown }>)
          .map((p) => `(${p.x},${p.y})`)
          .join(",");
        const closed = obj["closed"];
        return closed ? `(${points})` : `[${points}]`;
      }
      return null;
    case "polygon":
      if (Array.isArray(obj)) {
        // polygon is returned as an array of {x,y} points by pg
        return null; // handled above as Array case
      }
      return null;
    default:
      return null;
  }
}

/**
 * Serializes a pg interval object to a PostgreSQL interval literal string.
 * pg returns interval values as { years?, months?, days?, hours?, minutes?, seconds?, milliseconds? }.
 */
function serializeIntervalValue(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  const years = Number(obj["years"] ?? 0);
  const months = Number(obj["months"] ?? 0);
  const days = Number(obj["days"] ?? 0);
  const hours = Number(obj["hours"] ?? 0);
  const minutes = Number(obj["minutes"] ?? 0);
  const seconds = Number(obj["seconds"] ?? 0);
  const ms = Number(obj["milliseconds"] ?? 0);

  if (years) parts.push(`${years} year${Math.abs(years) !== 1 ? "s" : ""}`);
  if (months) parts.push(`${months} month${Math.abs(months) !== 1 ? "s" : ""}`);
  if (days) parts.push(`${days} day${Math.abs(days) !== 1 ? "s" : ""}`);

  const totalSeconds = seconds + ms / 1000;
  if (hours || minutes || totalSeconds) {
    const h = String(Math.abs(hours)).padStart(2, "0");
    const m = String(Math.abs(minutes)).padStart(2, "0");
    const s = Math.abs(totalSeconds)
      .toFixed(totalSeconds % 1 !== 0 ? 6 : 0)
      .padStart(2, "0");
    const sign =
      hours < 0 ||
      (hours === 0 && minutes < 0) ||
      (hours === 0 && minutes === 0 && totalSeconds < 0)
        ? "-"
        : "";
    parts.push(`${sign}${h}:${m}:${s}`);
  }

  return parts.length > 0 ? parts.join(" ") : "0";
}

/**
 * Deserializes a value from the diff JSON back to the form expected by pg.
 * - {$type: 'bytea', $value: '<base64>'} -> Buffer
 * - everything else -> as-is
 */
export function deserializeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)["$type"] === "bytea"
  ) {
    const b64 = (value as Record<string, unknown>)["$value"] as string;
    return Buffer.from(b64, "base64");
  }
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }
  return value;
}

/**
 * Compares two serialized values for equality.
 * - null vs null is equal
 * - JSON objects are compared structurally (key order does not matter)
 * - Arrays are compared element-wise
 * - Primitives use strict equality
 *
 * This is used for jsonb structural comparison and general value comparison.
 */
export function valuesAreEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;

  // Compare Buffer-encoded bytea
  if (
    typeof a === "object" &&
    typeof b === "object" &&
    (a as Record<string, unknown>)["$type"] === "bytea" &&
    (b as Record<string, unknown>)["$type"] === "bytea"
  ) {
    return (
      (a as Record<string, unknown>)["$value"] ===
      (b as Record<string, unknown>)["$value"]
    );
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => valuesAreEqual(v, b[i]));
  }

  if (
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    // Structural comparison for JSON/JSONB objects
    const aKeys = Object.keys(a as object).sort();
    const bKeys = Object.keys(b as object).sort();
    if (aKeys.length !== bKeys.length) return false;
    if (!aKeys.every((k, i) => k === bKeys[i])) return false;
    return aKeys.every((k) =>
      valuesAreEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    );
  }

  // Fall back to string comparison for numeric precision
  // pg returns numeric as strings
  return String(a) === String(b);
}
