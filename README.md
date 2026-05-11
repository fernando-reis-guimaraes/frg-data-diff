# frg-data-diff

> It compares row data between two PostgreSQL databases and safely applies changes.
>
> It also produces a review-only schema diff based on `information_schema`, with JSON/YAML artifacts plus SQL for manual execution.

Safe PostgreSQL **data** diff and apply tooling, with companion PostgreSQL **schema** diff output for manual review. Compare data between two PostgreSQL databases and apply changes with strong safety guards.

Primary use case: You have a production database copied to development. You change configuration data in development (e.g., Directus rows). You want to publish only those data changes back to production in a reviewable, auditable way.

---

## Install

```bash
npm install -g frg-data-diff
```

Or use directly with `npx` (no install required):

```bash
npx frg-data-diff
npx frg-data-diff generate
npx frg-data-diff apply
npx frg-data-diff sql
```

---

## Commands

### `frg-data-diff`

Root CLI. Prints usage information when run without a command.

```bash
npx frg-data-diff
```

### `frg-data-diff generate`

Compares a source PostgreSQL database against a destination PostgreSQL database and writes data diff plus schema diff files.

```bash
npx frg-data-diff generate
```

### `frg-data-diff apply`

Reads a JSON diff file and safely applies it to a destination PostgreSQL database.

```bash
npx frg-data-diff apply --dry-run
npx frg-data-diff apply --execute
```

### `frg-data-diff sql`

Reads a JSON diff file and writes a plain SQL script for manual review and execution.

```bash
npx frg-data-diff sql --input frg-data-diff.json --output frg-data-diff.sql
```

---

## Configuration File: `.frg-data-diff.config.json`

Commands look for this file in the current working directory.

### Committing the config file

**Do commit** `.frg-data-diff.config.json` to version control.

**Do not commit** raw passwords or connection strings.

Connection values may be plain text or `$ENV_VAR` references.

Passwords may be plain text too, but `$ENV_VAR` is recommended.

Generator list fields also support `$ENV_VAR` entries:

- `tables`
- `excludeTables`
- `schemaDiffTables`
- `schemaDiffExcludeTables`
- `pgTriggersTables`
- `pgTriggersExcludeTables`
- `ignoreColumns`

When used in those list fields, the environment variable value is parsed as a comma-separated list at runtime.

Data, schema diff, and PostgreSQL trigger table filters are independent. If a schema or trigger table/exclude field is omitted, it defaults to an empty list and does not inherit from `tables` or `excludeTables`.

In the interactive wizard, pressing Enter keeps the displayed default. For optional list fields, type `none` to clear the value; the config stores that explicit clear as an empty array.

### Example config

```json
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
    "tablesWhereDataFilters": {},
    "excludeTables": [],
    "schemaDiffTables": ["my_table"],
    "schemaDiffExcludeTables": [],
    "pgTriggersTables": ["my_table"],
    "pgTriggersExcludeTables": [],
    "pgTriggersOutput": "frg-triggers-diff.sql",
    "ignoreColumns": ["created_at", "updated_at"],
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

    "input": "frg-data-diff.json",
    "dryRun": true,
    "applyInserts": true,
    "applyUpdates": true,
    "applyDeletes": false,
    "conflictMode": "abort",
    "insertMode": "strict",
    "transaction": true
  }
}
```

### Row-level data filters

`tablesWhereDataFilters` is an optional generator config object. Keys are table names, and values are SQL `WHERE` fragments applied when reading table data for diff generation.

The filter is applied equally to source and destination reads. Rows outside the filter are ignored completely and are not treated as missing, so generated data SQL will not insert, update, or delete rows excluded by the filter. This affects data diff only, not schema diff, and is configured only in JSON.

Example:

```json
{
  "generator": {
    "tables": ["directus_presets"],
    "tablesWhereDataFilters": {
      "directus_presets": "\"user\" IS NULL"
    }
  }
}
```

For Directus, this compares only global/role presets and ignores personal Studio UI presets.

### Environment variable references

At runtime, any value stored as `$ENV_VAR` is read from the environment:

```bash
export PG_PASSWORD_DEV="actual-dev-password"
export PG_PASSWORD_PROD="actual-prod-password"
```

If the environment variable is missing:

```
Missing required environment variable for destination password: PG_PASSWORD_PROD
```

The actual value is never printed.

---

## No-args behavior

When invoked with **no arguments**:

1. Looks for `.frg-data-diff.config.json` in the current directory.
2. If not found: prints usage and exits with non-zero code.
3. If found: loads and validates config, prints the resolved execution plan, and asks:

```
Proceed? Type "yes" to continue:
```

Only the exact string `yes` proceeds. Anything else aborts without modifying anything.

---

## First-run config creation

When invoked with CLI arguments and no config file exists:

```
No .frg-data-diff.config.json file was found.
Create one from these options? Type "yes" to create:
```

Only `yes` creates the file. If declined, the operation continues without creating a config.

If you choose plain-text passwords, they are written to the config file as plain text.

---

## Confirmation behavior

- Interactive: you must type `yes` to proceed.
- Non-interactive / CI/CD: use `--yes` to skip confirmation.
- `--yes` does not bypass missing required parameters.

---

## Generator usage

```bash
npx frg-data-diff generate \
  --source-pg-host dev-db.example.com \
  --source-pg-port 5432 \
  --source-pg-database app \
  --source-pg-user app_user \
  --source-pg-password-env '$PG_PASSWORD_DEV' \
  --dest-pg-host prod-db.example.com \
  --dest-pg-port 5432 \
  --dest-pg-database app \
  --dest-pg-user app_user \
  --dest-pg-password-env '$PG_PASSWORD_PROD' \
  --schema public \
  --table my_table \
  --output frg-data-diff.json \
  --include-deletes \
  --pretty \
  --yes
```

Key options:

| Option                     | Description                                           |
| -------------------------- | ----------------------------------------------------- |
| `--source-pg-password-env` | Source DB password or `$ENV_VAR` reference            |
| `--dest-pg-password-env`   | Destination DB password or `$ENV_VAR` reference       |
| `--table`                  | Table(s) or `*` patterns to include (repeatable)      |
| `--exclude-table`          | Table(s) or `*` patterns to skip (repeatable)         |
| `--ignore-column`          | Column(s) to ignore during comparison (repeatable)    |
| `--include-deletes`        | Generate delete entries for rows only in dest         |
| `--skip-missing-pk`        | Skip tables without a primary key instead of failing  |
| `--output`                 | Output diff file path (default: `frg-data-diff.json`) |
| `--pretty`                 | Pretty-print the output JSON                          |
| `--yes`                    | Skip confirmation                                     |
| `--verbose`                | Enable verbose logging                                |

---

## Apply usage

### Dry-run (default — safe, no DB changes)

```bash
npx frg-data-diff apply \
  --dest-pg-host prod-db.example.com \
  --dest-pg-port 5432 \
  --dest-pg-database app \
  --dest-pg-user app_user \
  --dest-pg-password-env '$PG_PASSWORD_PROD' \
  --input frg-data-diff.json \
  --dry-run
```

### Real execution

```bash
npx frg-data-diff apply \
  --dest-pg-host prod-db.example.com \
  --dest-pg-database app \
  --dest-pg-user app_user \
  --dest-pg-password-env '$PG_PASSWORD_PROD' \
  --input frg-data-diff.json \
  --execute
```

Key options:

| Option               | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `--dry-run`          | Simulate apply, make no DB changes (default)             |
| `--execute`          | Actually apply changes to the DB                         |
| `--apply-deletes`    | Apply deletes (default: false, requires explicit opt-in) |
| `--no-apply-deletes` | Disable deletes (default)                                |
| `--conflict-mode`    | `abort` \| `skip` \| `overwrite`                         |
| `--insert-mode`      | `strict` \| `upsert`                                     |
| `--transaction`      | Wrap all changes in a transaction (default: true)        |
| `--no-transaction`   | Do not use a transaction                                 |
| `--yes`              | Skip confirmation                                        |
| `--verbose`          | Enable verbose logging                                   |

---

## Dry-run behavior

`--dry-run` never mutates the destination database. It simulates the apply and prints what would happen.

`--execute` is required to make real changes. If both are passed, an error is shown.

---

## JSON Diff Format

The diff file (`frg-data-diff.json`) uses a versioned format:

```json
{
  "format": "postgres-data-diff-json/v1",
  "generatedAt": "2026-05-11T21:00:00.000Z",
  "source": { "schema": "public" },
  "dest": { "schema": "public" },
  "options": {
    "includeDeletes": true,
    "ignoredColumns": ["updated_at"]
  },
  "tables": [
    {
      "schema": "public",
      "table": "example_table",
      "primaryKey": ["id"],
      "updates": [
        {
          "pk": { "id": 1 },
          "changes": {
            "name": { "from": "Old value", "to": "New value" }
          }
        }
      ],
      "inserts": [{ "row": { "id": 2, "name": "Inserted value" } }],
      "deletes": [
        {
          "pk": { "id": 3 },
          "guard": { "id": 3, "name": "Deleted value" }
        }
      ]
    }
  ],
  "summary": {
    "tablesCompared": 1,
    "updates": 1,
    "inserts": 1,
    "deletes": 1,
    "skippedTables": []
  }
}
```

The diff file is designed to be **reviewed before applying**.

Example list env vars:

```bash
export DIRECTUS_TABLES="directus_*, custom_table"
export DIRECTUS_EXCLUDES="directus_activity, directus_sessions"
export DIRECTUS_PG_TRIGGER_TABLES="directus_flows, directus_operations"
export DIRECTUS_PG_TRIGGER_EXCLUDES="directus_sessions"
export DIRECTUS_IGNORED_COLUMNS="created_at, updated_at"
```

```json
{
  "generator": {
    "tables": ["$DIRECTUS_TABLES"],
    "excludeTables": ["$DIRECTUS_EXCLUDES"],
    "pgTriggersTables": ["$DIRECTUS_PG_TRIGGER_TABLES"],
    "pgTriggersExcludeTables": ["$DIRECTUS_PG_TRIGGER_EXCLUDES"],
    "pgTriggersOutput": "frg-triggers-diff.sql",
    "ignoreColumns": ["$DIRECTUS_IGNORED_COLUMNS"]
  }
}
```

---

## Safety Model

- **Parameterized queries only** — values are never string-concatenated into SQL.
- **Identifier quoting** — all table and column names are properly quoted.
- **Update guards** — updates check that the destination `"from"` value still matches before applying.
- **Delete guards** — deletes check the full destination row still matches the stored guard before deleting.
- **applyDeletes defaults to false** — deletes never run without explicit opt-in.
- **dryRun defaults to true** — no mutations without `--execute`.
- **Transaction by default** — all changes in a single transaction; rolled back on failure in `abort` mode.
- **Generated columns are never written**.
- **Schema is never mutated**.

---

## Conflict Modes

| Mode        | Behavior                                                  |
| ----------- | --------------------------------------------------------- |
| `abort`     | Roll back transaction on first conflict (default, safest) |
| `skip`      | Skip conflicting row, continue, record in summary         |
| `overwrite` | Force apply changes, ignore from-value guards for updates |

Note: `overwrite` does **not** disable guarded deletes. Delete guards always apply.

---

## Delete Behavior

1. Deletes are **generated** only when `includeDeletes: true` in the generator config.
2. Deletes are **applied** only when `applyDeletes: true` in the apply config.
3. When applied, deletes use a guard check using `IS NOT DISTINCT FROM` semantics.
4. If the destination row changed after the diff was generated, the guarded delete will:
   - In `abort` mode: throw and roll back.
   - In `skip` mode: skip the delete, record it in summary.
   - In `overwrite` mode: the delete guard still applies (overwrite only disables update guards).

---

## Directus Example Config

For publishing Directus configuration data from development to production:

```json
{
  "format": "frg-data-diff-config/v1",
  "generator": {
    "sourcePgHost": "dev-db.example.com",
    "sourcePgPort": 5432,
    "sourcePgDatabase": "directus",
    "sourcePgUser": "directus",
    "sourcePgPassword": "PG_PASSWORD_DEV",

    "destPgHost": "prod-db.example.com",
    "destPgPort": 5432,
    "destPgDatabase": "directus",
    "destPgUser": "directus",
    "destPgPassword": "PG_PASSWORD_PROD",

    "schema": "public",
    "tables": [
      "directus_collections",
      "directus_fields",
      "directus_relations",
      "directus_permissions",
      "directus_roles",
      "directus_policies",
      "directus_access",
      "directus_settings",
      "directus_flows",
      "directus_operations",
      "directus_dashboards",
      "directus_panels",
      "directus_translations",
      "directus_presets",
      "directus_webhooks"
    ],
    "tablesWhereDataFilters": {
      "directus_presets": "\"user\" IS NULL"
    },
    "excludeTables": [
      "directus_activity",
      "directus_revisions",
      "directus_sessions",
      "directus_migrations",
      "directus_notifications"
    ],
    "pgTriggersTables": ["directus_flows", "directus_operations"],
    "pgTriggersExcludeTables": [],
    "pgTriggersOutput": "frg-triggers-diff.sql",
    "ignoreColumns": ["created_at", "updated_at"],
    "includeDeletes": true,
    "skipMissingPk": false,
    "output": "frg-data-diff.json",
    "pretty": true
  },
  "apply": {
    "destPgHost": "prod-db.example.com",
    "destPgPort": 5432,
    "destPgDatabase": "directus",
    "destPgUser": "directus",
    "destPgPassword": "PG_PASSWORD_PROD",

    "input": "frg-data-diff.json",
    "dryRun": true,
    "applyInserts": true,
    "applyUpdates": true,
    "applyDeletes": false,
    "conflictMode": "abort",
    "insertMode": "strict",
    "transaction": true
  }
}
```

Notes:

- Runtime/audit/session tables (`directus_activity`, `directus_revisions`, etc.) are excluded — they should not be overwritten.
- `tablesWhereDataFilters.directus_presets` ignores personal Directus Studio UI presets while still comparing global/role presets.
- `includeDeletes: true` generates delete entries, but `applyDeletes: false` means they are never applied unless you explicitly enable them.
- To apply deletes: `npx frg-data-diff apply --execute --apply-deletes`

---

## Production Workflow

```
1. Copy production DB to development.
2. Change data/configuration in development.
3. Commit .frg-data-diff.config.json to repo.
4. Generate diff:

   npx frg-data-diff generate

5. Review frg-data-diff.json carefully.
6. Dry-run apply:

   npx frg-data-diff apply --dry-run

7. Real apply:

   npx frg-data-diff apply --execute
```

If applying deletes:

```bash
npx frg-data-diff apply --execute --apply-deletes
```

---

## What Is Not Supported

- Schema diff (table creation, column changes, index changes) — use a dedicated schema migration tool.
- Cross-schema comparisons within a single call (one schema per run).
- Tables without primary keys (use `--skip-missing-pk` to skip them).
- Views, materialized views, foreign tables.
- Streaming of very large tables — v1 loads each table into memory. For huge tables, process in smaller table batches.
- PostgreSQL pseudo-types and internal-only types as table columns.
- Multiple databases in a single run — run the tool once per database pair.

---

## Running Unit Tests

```bash
npm run test:unit
```

---

## Running Integration Tests

Integration tests require Docker and Docker Compose.

```bash
# Start the two PostgreSQL test instances
docker compose up -d

# Wait for them to be healthy, then run
npm run test:integration
```

Environment variables (with defaults):

```
PG_SOURCE_HOST=localhost    PG_SOURCE_PORT=15432    PG_SOURCE_DB=testdb    PG_SOURCE_USER=testuser    PG_SOURCE_PASSWORD=testpassword
PG_DEST_HOST=localhost      PG_DEST_PORT=15433      PG_DEST_DB=testdb      PG_DEST_USER=testuser      PG_DEST_PASSWORD=testpassword
```

Stop when done:

```bash
docker compose down
```

---

## Testing `npx` / Package Binary Behavior

```bash
# Build
npm run build

# Pack locally
npm pack

# Install from pack
npm install -g ./frg-data-diff-1.1.0.tgz

# Test
frg-data-diff
frg-data-diff generate --help
frg-data-diff apply --help
frg-data-diff sql --help
```

---

## Known Limitations

1. **Memory**: All rows for a table are loaded into memory. Not suitable for tables with millions of rows in v1.
2. **No streaming**: Pagination is used within the tool, but the result set is buffered.
3. **Schema mismatch**: If source and dest have different columns, only common columns are compared.
4. **No schema migration**: This tool does not create tables, add columns, or change indexes.
5. **Single schema per run**: All tables must be in the same schema.
6. **Env var references use shell-style names**: `$ENV_VAR`, `$envVar`, and `$env_var` are all valid.

---

## Building

```bash
npm run build       # Compile TypeScript to dist/
npm run typecheck   # Type-check without emitting
```
