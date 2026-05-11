#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=guided-manual-tests/common.sh
source "$SCRIPT_DIR/common.sh"

echo "[A] Installing npm dependencies from repo root"
(cd "$REPO_ROOT" && npm install)

echo "[A] Resetting Docker Compose PostgreSQL environment"
echo "Compose file: $COMPOSE_FILE"
echo "Compose project: $COMPOSE_PROJECT_NAME"
echo "Services: $SOURCE_SERVICE, $DEST_SERVICE"
print_connection_summaries

echo "Writing guided manual-test config: $CONFIG_FILE"
write_guided_config

printf "\nStopping compose stack...\n"
compose_cmd stop || true

echo "Removing compose stack and volumes..."
compose_cmd down -v --remove-orphans

echo "Starting compose stack..."
compose_cmd up -d

echo "Waiting for PostgreSQL services to become healthy..."
wait_for_service_healthy "$SOURCE_SERVICE"
wait_for_service_healthy "$DEST_SERVICE"

echo "Verifying both databases are reachable..."
source_psql -Atc 'SELECT current_database(), current_user, 1;'
dest_psql -Atc 'SELECT current_database(), current_user, 1;'

echo "Checking both databases are empty (excluding system schemas)..."
source_non_system_tables="$(source_psql -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');")"
dest_non_system_tables="$(dest_psql -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');")"

if [[ "$source_non_system_tables" != "0" || "$dest_non_system_tables" != "0" ]]; then
  echo "ERROR: Databases are not empty. source=$source_non_system_tables dest=$dest_non_system_tables" >&2
  exit 1
fi

echo "Confirmed: both source and destination are empty."
printf "\nNext step: %s\n" "$REPO_ROOT/guided-manual-tests/b-seed-databases.sh"
