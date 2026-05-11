#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=guided-manual-tests/common.sh
source "$SCRIPT_DIR/common.sh"

ensure_output_dir

timestamp="$(date +%Y%m%d-%H%M%S)"
source_dump="$OUTPUT_DIR/source-before-apply-$timestamp.sql"
dest_dump="$OUTPUT_DIR/dest-before-apply-$timestamp.sql"

echo "[E] Dumping source and destination databases before apply"
echo "Source database affected: $PG_SOURCE_HOST:$PG_SOURCE_PORT/$PG_SOURCE_DB"
echo "Destination database affected: $PG_DEST_HOST:$PG_DEST_PORT/$PG_DEST_DB"

source_pg_dump > "$source_dump"
dest_pg_dump > "$dest_dump"

echo "Source dump: $source_dump"
echo "Destination dump: $dest_dump"

printf "\nNext manual action: inspect dumps and confirm source/destination differ before apply.\n"
echo "Useful command: diff -u '$dest_dump' '$source_dump' | less"
echo "Next step: $REPO_ROOT/guided-manual-tests/f-apply-changes.sh"
