#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=guided-manual-tests/common.sh
source "$SCRIPT_DIR/common.sh"

ensure_output_dir

DIFF_FILE="$OUTPUT_DIR/frg-data-diff.json"

echo "[D] Generating diff JSON"
echo "Using config: $CONFIG_FILE"
echo "Output file: $DIFF_FILE"
echo "Comparing source database against destination database..."

run_generator --config "$CONFIG_FILE" --output "$DIFF_FILE" --yes

if [[ ! -f "$DIFF_FILE" ]]; then
	echo "ERROR: Expected diff file not found: $DIFF_FILE" >&2
	exit 1
fi

tables_compared="$(jq -r '.summary.tablesCompared' "$DIFF_FILE")"
inserts="$(jq -r '.summary.inserts' "$DIFF_FILE")"
updates="$(jq -r '.summary.updates' "$DIFF_FILE")"
deletes="$(jq -r '.summary.deletes' "$DIFF_FILE")"
skipped_tables="$(jq -r '(.summary.skippedTables // []) | if length == 0 then "none" else join(", ") end' "$DIFF_FILE")"

printf "\nDiff JSON generated at: %s\n" "$DIFF_FILE"
echo "Summary:"
echo "  Tables compared: $tables_compared"
echo "  Inserts: $inserts"
echo "  Updates: $updates"
echo "  Deletes: $deletes"
echo "  Skipped tables: $skipped_tables"

printf "\nNext manual action: review the JSON diff file before apply.\n"
echo "Useful command: jq '.' '$DIFF_FILE' | less"
echo "Next step: $REPO_ROOT/guided-manual-tests/e-dump-databases-before-apply.sh"
