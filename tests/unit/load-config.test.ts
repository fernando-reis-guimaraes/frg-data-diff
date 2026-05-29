import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  findConfigFile,
  loadConfig,
  DEFAULT_CONFIG_FILENAME,
} from "../../src/config/load-config";

const validConfigContent = JSON.stringify({
  format: "frg-data-diff-config/v1",
  generator: {
    sourcePgHost: "dev-db.example.com",
    sourcePgPort: 5432,
    sourcePgDatabase: "app",
    sourcePgUser: "app_user",
    sourcePgPassword: "$PG_PASSWORD_DEV",
    sourcePgSsl: true,
    destPgHost: "prod-db.example.com",
    destPgPort: 5432,
    destPgDatabase: "app",
    destPgUser: "app_user",
    destPgPassword: "$PG_PASSWORD_PROD",
    destPgSsl: false,
    schema: "public",
    tables: ["my_table"],
    excludeTables: [],
    ignoreColumns: [],
    includeDeletes: true,
    skipMissingPk: false,
    output: "frg-data-diff.json",
    pretty: true,
  },
  apply: {
    destPgHost: "prod-db.example.com",
    destPgPort: 5432,
    destPgDatabase: "app",
    destPgUser: "app_user",
    destPgPassword: "$PG_PASSWORD_PROD",
    destPgSsl: false,
    input: "frg-data-diff.json",
    dryRun: true,
    applyInserts: true,
    applyUpdates: true,
    applyDeletes: false,
    conflictMode: "abort",
    insertMode: "strict",
    transaction: true,
  },
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "frg-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("findConfigFile", () => {
  it("returns the config path when it exists", () => {
    const configPath = path.join(tmpDir, DEFAULT_CONFIG_FILENAME);
    fs.writeFileSync(configPath, validConfigContent);
    const result = findConfigFile(tmpDir);
    expect(result).toBe(configPath);
  });

  it("returns null when config does not exist", () => {
    const result = findConfigFile(tmpDir);
    expect(result).toBeNull();
  });
});

describe("loadConfig", () => {
  it("loads and validates a valid config file", () => {
    const configPath = path.join(tmpDir, DEFAULT_CONFIG_FILENAME);
    fs.writeFileSync(configPath, validConfigContent);
    const config = loadConfig(configPath);
    expect(config.format).toBe("frg-data-diff-config/v1");
    expect(config.generator.sourcePgHost).toBe("dev-db.example.com");
    expect(config.apply.destPgHost).toBe("prod-db.example.com");
  });

  it("loads config files with line and block comments", () => {
    const configPath = path.join(tmpDir, DEFAULT_CONFIG_FILENAME);
    fs.writeFileSync(
      configPath,
      `{
        // Config format marker
        "format": "frg-data-diff-config/v1",
        "generator": {
          "sourcePgHost": "https://dev-db.example.com",
          "sourcePgPort": 5432,
          "sourcePgDatabase": "app",
          "sourcePgUser": "app_user",
          "sourcePgPassword": "pa//ss/*not-comment*/",
          "sourcePgSsl": true,
          /*
           * Destination connection
           */
          "destPgHost": "prod-db.example.com",
          "destPgPort": 5432,
          "destPgDatabase": "app",
          "destPgUser": "app_user",
          "destPgPassword": "$PG_PASSWORD_PROD",
          "destPgSsl": false,
          "schema": "public",
          "tables": ["my_table"],
          "excludeTables": [],
          "ignoreColumns": [],
          "includeDeletes": true,
          "skipMissingPk": false,
          "output": "frg-data-diff.json",
          "pretty": true
        },
        "apply": {
          "destPgHost": "prod-db.example.com",
          "destPgPort": 5432,
          "destPgDatabase": "app",
          "destPgUser": "app_user",
          "destPgPassword": "$PG_PASSWORD_PROD",
          "destPgSsl": false,
          "input": "frg-data-diff.json",
          "dryRun": true,
          "applyInserts": true,
          "applyUpdates": true,
          "applyDeletes": false,
          "conflictMode": "abort",
          "insertMode": "strict",
          "transaction": true
        }
      }`,
    );

    const config = loadConfig(configPath);
    expect(config.generator.sourcePgHost).toBe("https://dev-db.example.com");
    expect(config.generator.sourcePgPassword).toBe("pa//ss/*not-comment*/");
    expect(config.apply.destPgHost).toBe("prod-db.example.com");
  });

  it("exits with code 1 on invalid JSON", () => {
    const configPath = path.join(tmpDir, DEFAULT_CONFIG_FILENAME);
    fs.writeFileSync(configPath, "not valid json {{{");
    // Mock process.exit
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    }) as any;
    try {
      loadConfig(configPath);
    } catch {
      // Expected
    } finally {
      process.exit = originalExit;
    }
    expect(exitCode).toBe(1);
  });

  it("exits with code 1 on schema validation failure", () => {
    const configPath = path.join(tmpDir, DEFAULT_CONFIG_FILENAME);
    fs.writeFileSync(configPath, JSON.stringify({ format: "wrong" }));
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    }) as any;
    try {
      loadConfig(configPath);
    } catch {
      // Expected
    } finally {
      process.exit = originalExit;
    }
    expect(exitCode).toBe(1);
  });
});
