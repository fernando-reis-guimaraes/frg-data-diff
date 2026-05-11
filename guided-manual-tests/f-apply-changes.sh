#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=guided-manual-tests/common.sh
source "$SCRIPT_DIR/common.sh"

ensure_output_dir

diff_file="$OUTPUT_DIR/frg-data-diff.json"

if [[ ! -f "$diff_file" ]]; then
	echo "ERROR: Diff file not found. Run d-produce-diff-json.sh first." >&2
	exit 1
fi

diff_deletes="$(jq -r '.summary.deletes // 0' "$diff_file")"
config_apply_deletes="$(jq -r '.apply.applyDeletes // false' "$CONFIG_FILE")"

if [[ "$diff_deletes" -gt 0 && "$config_apply_deletes" == "true" ]]; then
	delete_flag="--apply-deletes"
	echo "Delete application enabled: diff includes deletes and config allows deletes."
else
	delete_flag="--no-apply-deletes"
	echo "Delete application disabled for safety (either no deletes in diff or config disallows deletes)."
fi

dry_run_log="$OUTPUT_DIR/apply-dry-run.log"
dry_run_summary="$OUTPUT_DIR/apply-dry-run-summary.json"
apply_log="$OUTPUT_DIR/apply-execute.log"
apply_summary="$OUTPUT_DIR/apply-execute-summary.json"

echo "[F] Dry-run apply to destination"
echo "Destination database affected: $PG_DEST_HOST:$PG_DEST_PORT/$PG_DEST_DB"
echo "Dry-run log: $dry_run_log"

run_apply --config "$CONFIG_FILE" --input "$diff_file" --dry-run "$delete_flag" --yes | tee "$dry_run_log"
extract_summary_json "$dry_run_log" "$dry_run_summary"

printf "\nDry-run summary:\n"
echo "  Inserts applied: $(jq -r '.applied.inserts' "$dry_run_summary")"
echo "  Updates applied: $(jq -r '.applied.updates' "$dry_run_summary")"
echo "  Deletes applied: $(jq -r '.applied.deletes' "$dry_run_summary")"
echo "  Conflicts: $(jq -r '.conflicts | length' "$dry_run_summary")"
echo "  Skipped rows: $(jq -r '.skipped | length' "$dry_run_summary")"

echo
echo 'Type "apply" to apply changes to the destination database:'
read -r confirm

if [[ "$confirm" != "apply" ]]; then
	echo "Confirmation was not exact 'apply'. Aborting without mutating destination."
	exit 0
fi

echo "Running real apply..."
run_apply --config "$CONFIG_FILE" --input "$diff_file" --execute "$delete_flag" --yes | tee "$apply_log"
extract_summary_json "$apply_log" "$apply_summary"

printf "\nApply summary:\n"
echo "  Inserts applied: $(jq -r '.applied.inserts' "$apply_summary")"
echo "  Updates applied: $(jq -r '.applied.updates' "$apply_summary")"
echo "  Deletes applied: $(jq -r '.applied.deletes' "$apply_summary")"
echo "  Conflicts: $(jq -r '.conflicts | length' "$apply_summary")"
echo "  Skipped rows: $(jq -r '.skipped | length' "$apply_summary")"

printf "\nNext step: %s\n" "$REPO_ROOT/guided-manual-tests/g-final-dump-and-verify.sh"
