#!/usr/bin/env node
/**
 * frg-data-diff
 *
 * Root CLI dispatcher. Routes subcommands to the focused tools.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const subcommand = process.argv[2];
const subcommandArgs = process.argv.slice(3);
const commandFiles: Record<string, string> = {
  generate: "generator.js",
  apply: "apply.js",
  sql: "sql.js",
  "pg-triggers": "pg-triggers.js",
  "pg-views": "pg-views.js",
};

const helpText = `frg-data-diff

Usage:

  npx frg-data-diff <command> [options]

Commands:

  generate     Compare source and destination PostgreSQL databases and write diff artifacts.
  apply        Read a JSON diff file and safely apply it to a destination PostgreSQL database.
  sql          Read a JSON diff file and write a plain SQL script for manual review and execution.
  pg-triggers  Compare PostgreSQL triggers and functions and write a SQL diff script.
  pg-views     Compare PostgreSQL view definitions and write a SQL diff script.
  version      Print the package version.

Basic usage:

  npx frg-data-diff generate
  npx frg-data-diff apply --dry-run
  npx frg-data-diff apply --execute
  npx frg-data-diff sql --yes
  npx frg-data-diff pg-triggers
  npx frg-data-diff pg-views
  npx frg-data-diff version

Config file:
  .frg-data-diff.config.json

  Commands look for .frg-data-diff.config.json in the current directory.
  Create it by running a command with --config or with CLI args on first run.

How to generate a diff:

  npx frg-data-diff generate \\
    --source-pg-host dev-db.example.com \\
    --source-pg-port 5432 \\
    --source-pg-database app \\
    --source-pg-user app_user \\
    --source-pg-password-env '$PG_PASSWORD_DEV' \\
    --dest-pg-host prod-db.example.com \\
    --dest-pg-port 5432 \\
    --dest-pg-database app \\
    --dest-pg-user app_user \\
    --dest-pg-password-env '$PG_PASSWORD_PROD' \\
    --schema public \\
    --output frg-data-diff.json \\
    --include-deletes \\
    --pretty

How to apply a diff (dry-run first):

  npx frg-data-diff apply \\
    --dest-pg-host prod-db.example.com \\
    --dest-pg-port 5432 \\
    --dest-pg-database app \\
    --dest-pg-user app_user \\
    --dest-pg-password-env '$PG_PASSWORD_PROD' \\
    --input frg-data-diff.json \\
    --dry-run

How to apply a diff (real execution):

  npx frg-data-diff apply \\
    --dest-pg-host prod-db.example.com \\
    --dest-pg-port 5432 \\
    --dest-pg-database app \\
    --dest-pg-user app_user \\
    --dest-pg-password-env '$PG_PASSWORD_PROD' \\
    --input frg-data-diff.json \\
    --execute

How to generate SQL from a diff:

  npx frg-data-diff sql \\
    --input frg-data-diff.json \\
    --output frg-data-diff.sql \\
    --apply-deletes \\
    --yes

Config file example (.frg-data-diff.config.json):

  {
    "format": "frg-data-diff-config/v1",
    "generator": {
      "sourcePgHost": "dev-db.example.com",
      "sourcePgPort": 5432,
      "sourcePgDatabase": "app",
      "sourcePgUser": "app_user",
      "sourcePgPassword": "$PG_PASSWORD_DEV",
      "destPgHost": "prod-db.example.com",
      "destPgPort": 5432,
      "destPgDatabase": "app",
      "destPgUser": "app_user",
      "destPgPassword": "$PG_PASSWORD_PROD",
      "schema": "public",
      "tables": ["my_table"],
      "output": "frg-data-diff.json",
      "schemaDiffTables": ["my_table"],
      "schemaDiffOutput": "frg-schema-diff.json",
      "pgTriggersTables": ["my_table"],
      "pgTriggersOutput": "frg-triggers-diff.sql",
      "pgViews": ["*"],
      "pgViewsOutput": "frg-views-diff.sql",
      "includeDeletes": true,
      "pretty": true
    },
    "apply": {
      "destPgHost": "prod-db.example.com",
      "destPgPort": 5432,
      "destPgDatabase": "app",
      "destPgUser": "app_user",
      "destPgPassword": "$PG_PASSWORD_PROD",
      "input": "frg-data-diff.json",
      "dryRun": true,
      "applyDeletes": false
    }
  }

Safety notes:

  - Do not commit secrets (passwords, connection strings) to version control.
  - Connection values may be plain text or $ENV_VAR references.
  - Passwords may be plain text, but $ENV_VAR is strongly recommended.
  - Missing env vars will cause a clear error showing only the env var name, never the value.
  - Apply defaults to dry-run mode. Use --execute to apply real changes.
  - applyDeletes defaults to false. Deletes require explicit opt-in.
  - Use --yes for CI/CD to skip interactive confirmation.
  - If you choose plain-text passwords, they will be written exactly that way to the config file.

For CI/CD:

  npx frg-data-diff generate --yes
  npx frg-data-diff apply --yes --execute
`;

if (!subcommand || subcommand === "--help" || subcommand === "-h") {
  process.stdout.write(helpText);
  process.exit(0);
}

if (
  subcommand === "version" ||
  subcommand === "--version" ||
  subcommand === "-v"
) {
  console.log(readPackageVersion());
  process.exit(0);
}

const commandFile = commandFiles[subcommand];

if (!commandFile) {
  console.error(`Unknown command: ${subcommand}`);
  console.error("");
  process.stderr.write(helpText);
  process.exit(1);
}

const commandPath = path.join(__dirname, commandFile);

if (!fs.existsSync(commandPath)) {
  console.error(`Command file not found: ${commandPath}`);
  console.error("Run npm run build and try again.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [commandPath, ...subcommandArgs], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.signal) {
  console.error(`Command terminated by signal: ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 0);

function readPackageVersion(): string {
  const packagePath = path.resolve(__dirname, "../../package.json");
  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as {
      version?: unknown;
    };
    if (typeof packageJson.version === "string" && packageJson.version) {
      return packageJson.version;
    }
  } catch {
    // Fall through to a clear, stable value if package metadata is unavailable.
  }
  return "unknown";
}
