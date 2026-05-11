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
    parsed = JSON.parse(raw);
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
