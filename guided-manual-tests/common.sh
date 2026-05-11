#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$REPO_ROOT/guided-manual-tests/output"
COMPOSE_FILE="$REPO_ROOT/compose.yaml"
COMPOSE_PROJECT_NAME="frg-data-diff-manual"
SOURCE_SERVICE="pg_source"
DEST_SERVICE="pg_dest"

export PG_SOURCE_HOST="${PG_SOURCE_HOST:-localhost}"
export PG_SOURCE_PORT="${PG_SOURCE_PORT:-16432}"
export PG_SOURCE_DB="${PG_SOURCE_DB:-testdb}"
export PG_SOURCE_USER="${PG_SOURCE_USER:-testuser}"

export PG_DEST_HOST="${PG_DEST_HOST:-localhost}"
export PG_DEST_PORT="${PG_DEST_PORT:-16433}"
export PG_DEST_DB="${PG_DEST_DB:-testdb}"
export PG_DEST_USER="${PG_DEST_USER:-testuser}"

export PG_PASSWORD_SOURCE="${PG_PASSWORD_SOURCE:-testpassword}"
export PG_PASSWORD_DEST="${PG_PASSWORD_DEST:-testpassword}"

# Shared globals below are intentionally consumed by sibling guided scripts after `source common.sh`.
# shellcheck disable=SC2034
{
	CONFIG_FILE="$REPO_ROOT/guided-manual-tests/.frg-data-diff.config.json"
	MANUAL_TEST_TABLES=(
		test_all_types
		user_all_types
		test_composite_pk
		user_composite_pk
		test_nullable_values
		user_nullable_values
		test_no_pk
		user_no_pk
	)
}

compose_cmd() {
	docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT_NAME" "$@"
}

ensure_output_dir() {
	mkdir -p "$OUTPUT_DIR"
}

source_psql() {
	compose_cmd exec -T "$SOURCE_SERVICE" env PGPASSWORD="$PG_PASSWORD_SOURCE" \
		psql -v ON_ERROR_STOP=1 -U "$PG_SOURCE_USER" -d "$PG_SOURCE_DB" "$@"
}

dest_psql() {
	compose_cmd exec -T "$DEST_SERVICE" env PGPASSWORD="$PG_PASSWORD_DEST" \
		psql -v ON_ERROR_STOP=1 -U "$PG_DEST_USER" -d "$PG_DEST_DB" "$@"
}

source_pg_dump() {
	compose_cmd exec -T "$SOURCE_SERVICE" env PGPASSWORD="$PG_PASSWORD_SOURCE" \
		pg_dump -U "$PG_SOURCE_USER" -d "$PG_SOURCE_DB" --no-owner --no-privileges "$@"
}

dest_pg_dump() {
	compose_cmd exec -T "$DEST_SERVICE" env PGPASSWORD="$PG_PASSWORD_DEST" \
		pg_dump -U "$PG_DEST_USER" -d "$PG_DEST_DB" --no-owner --no-privileges "$@"
}

wait_for_service_healthy() {
	local service="$1"
	local attempts=60
	local i=0

	while [[ "$i" -lt "$attempts" ]]; do
		local container
		container="$(compose_cmd ps -q "$service" 2>/dev/null || true)"
		local status
		status="$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || true)"
		if [[ "$status" == "healthy" ]]; then
			return 0
		fi
		sleep 2
		i=$((i + 1))
	done

	echo "ERROR: Service '$service' did not become healthy in time." >&2
	return 1
}

run_generator() {
	local generator_cli_path="$REPO_ROOT/dist/cli/generator.js"

	if [[ ! -f "$generator_cli_path" ]]; then
		echo "Local build not found. Building local CLI files..."
		(cd "$REPO_ROOT" && npm run build >/dev/null)
	fi

	if [[ ! -f "$generator_cli_path" ]]; then
		echo "ERROR: Expected local generator CLI file not found: $generator_cli_path" >&2
		return 1
	fi

	(cd "$REPO_ROOT" && node dist/cli/generator.js "$@")
}

run_apply() {
	local apply_cli_path="$REPO_ROOT/dist/cli/apply.js"

	if [[ ! -f "$apply_cli_path" ]]; then
		echo "Local build not found. Building local CLI files..."
		(cd "$REPO_ROOT" && npm run build >/dev/null)
	fi

	if [[ ! -f "$apply_cli_path" ]]; then
		echo "ERROR: Expected local apply CLI file not found: $apply_cli_path" >&2
		return 1
	fi

	(cd "$REPO_ROOT" && node dist/cli/apply.js "$@")
}

extract_summary_json() {
	local log_file="$1"
	local output_file="$2"
	awk 'f{print} /Machine-readable summary:/{f=1; next}' "$log_file" >"$output_file"
}

print_connection_summaries() {
	cat <<INFO
Source DB (no password shown):
  host=$PG_SOURCE_HOST port=$PG_SOURCE_PORT db=$PG_SOURCE_DB user=$PG_SOURCE_USER
Destination DB (no password shown):
  host=$PG_DEST_HOST port=$PG_DEST_PORT db=$PG_DEST_DB user=$PG_DEST_USER
INFO
}

write_guided_config() {
	cat >"$CONFIG_FILE" <<JSON
{
  "format": "frg-data-diff-config/v1",
  "generator": {
    "sourcePgHost": "$PG_SOURCE_HOST",
    "sourcePgPort": $PG_SOURCE_PORT,
    "sourcePgDatabase": "$PG_SOURCE_DB",
    "sourcePgUser": "$PG_SOURCE_USER",
    "sourcePgPassword": "\$PG_PASSWORD_SOURCE",
    "sourcePgSsl": false,
    "destPgHost": "$PG_DEST_HOST",
    "destPgPort": $PG_DEST_PORT,
    "destPgDatabase": "$PG_DEST_DB",
    "destPgUser": "$PG_DEST_USER",
    "destPgPassword": "\$PG_PASSWORD_DEST",
    "destPgSsl": false,
    "schema": "public",
    "tables": [
      "test_all_types",
      "user_all_types",
      "test_composite_pk",
      "user_composite_pk",
      "test_nullable_values",
      "user_nullable_values",
      "test_no_pk",
      "user_no_pk"
    ],
    "excludeTables": [],
    "ignoreColumns": [],
    "includeDeletes": true,
    "skipMissingPk": true,
    "output": "guided-manual-tests/output/frg-data-diff.json",
    "pretty": true
  },
  "apply": {
    "destPgHost": "$PG_DEST_HOST",
    "destPgPort": $PG_DEST_PORT,
    "destPgDatabase": "$PG_DEST_DB",
    "destPgUser": "$PG_DEST_USER",
    "destPgPassword": "\$PG_PASSWORD_DEST",
    "destPgSsl": false,
    "input": "guided-manual-tests/output/frg-data-diff.json",
    "dryRun": true,
    "applyInserts": true,
    "applyUpdates": true,
    "applyDeletes": true,
    "conflictMode": "abort",
    "insertMode": "strict",
    "transaction": true
  }
}
JSON
}
