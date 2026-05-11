#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=guided-manual-tests/common.sh
source "$SCRIPT_DIR/common.sh"

ensure_output_dir

timestamp="$(date +%Y%m%d-%H%M%S)"
source_dump="$OUTPUT_DIR/source-after-apply-$timestamp.sql"
dest_dump="$OUTPUT_DIR/dest-after-apply-$timestamp.sql"
verification_diff="$OUTPUT_DIR/final-verification-diff.json"
verification_report="$OUTPUT_DIR/final-verification.json"

echo "[G] Final dumps and equality verification"
echo "Dumping source and destination databases after apply..."

source_pg_dump > "$source_dump"
dest_pg_dump > "$dest_dump"

echo "Source final dump: $source_dump"
echo "Destination final dump: $dest_dump"

echo "Generating final verification diff JSON..."
run_generator --config "$CONFIG_FILE" --output "$verification_diff" --yes

final_inserts="$(jq -r '.summary.inserts' "$verification_diff")"
final_updates="$(jq -r '.summary.updates' "$verification_diff")"
final_deletes="$(jq -r '.summary.deletes' "$verification_diff")"
final_tables_compared="$(jq -r '.summary.tablesCompared' "$verification_diff")"
final_skipped_tables="$(jq -c '.summary.skippedTables // []' "$verification_diff")"

if [[ "$final_inserts" == "0" && "$final_updates" == "0" && "$final_deletes" == "0" ]]; then
  result="PASS"
  message="PASS: source and destination are equal for included tables."
else
  result="FAIL"
  message="FAIL: source and destination differ. See output files."
fi

jq -n \
  --arg result "$result" \
  --arg message "$message" \
  --arg sourceDump "$source_dump" \
  --arg destDump "$dest_dump" \
  --arg verificationDiff "$verification_diff" \
  --argjson tablesCompared "$final_tables_compared" \
  --argjson inserts "$final_inserts" \
  --argjson updates "$final_updates" \
  --argjson deletes "$final_deletes" \
  --argjson skippedTables "$final_skipped_tables" \
  '{
    result: $result,
    message: $message,
    sourceDump: $sourceDump,
    destDump: $destDump,
    verificationDiff: $verificationDiff,
    summary: {
      tablesCompared: $tablesCompared,
      inserts: $inserts,
      updates: $updates,
      deletes: $deletes,
      skippedTables: $skippedTables
    }
  }' > "$verification_report"

echo "Machine-readable verification report: $verification_report"
echo "$message"

printf "\nUseful verification commands:\n"
echo "  jq '.' '$verification_report'"
echo "  jq '.summary' '$verification_diff'"
