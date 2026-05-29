import * as fs from "fs";
import * as path from "path";
import { configSchema, type Config } from "./config-schema";

export const DEFAULT_CONFIG_FILENAME = ".frg-data-diff.config.json";

/**
 * Returns the path to the config file if it exists, or null.
 */
export function findConfigFile(cwd: string = process.cwd()): string | null {
  const configPath = path.join(cwd, DEFAULT_CONFIG_FILENAME);
  if (fs.existsSync(configPath)) {
    return configPath;
  }
  return null;
}

/**
 * Loads and validates the config file at the given path.
 * Exits with a clear error if validation fails.
 */
export function loadConfig(configPath: string): Config {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (err) {
    console.error(`Failed to read config file: ${configPath}`);
    if (err instanceof Error) console.error(err.message);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (err) {
    console.error(`Failed to parse config file as JSON: ${configPath}`);
    if (err instanceof Error) console.error(err.message);
    process.exit(1);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    console.error(`Config file validation failed: ${configPath}`);
    const formatted = result.error.format();
    console.error(JSON.stringify(formatted, null, 2));
    process.exit(1);
  }

  return result.data;
}

export function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    const next = input[index + 1];

    if (inLineComment) {
      if (isLineBreak(char)) {
        inLineComment = false;
        output += char;
      } else {
        output += " ";
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        output += "  ";
        index++;
        inBlockComment = false;
        continue;
      }

      if (isLineBreak(char)) {
        output += char;
      } else {
        output += " ";
      }
      continue;
    }

    if (inString) {
      output += char;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      output += "  ";
      index++;
      inLineComment = true;
      continue;
    }

    if (char === "/" && next === "*") {
      output += "  ";
      index++;
      inBlockComment = true;
      continue;
    }

    output += char;
  }

  return output;
}

function isLineBreak(char: string): boolean {
  if (char === "\n") {
    return true;
  }
  return char === "\r";
}
