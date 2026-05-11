#!/usr/bin/env bash
set -euo pipefail

if [ "${FRG_ENVRC_PRESERVED:-}" != "1" ]; then
	REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
	exec "$REPO_ROOT/scripts/preserve-envrc.sh" "$REPO_ROOT/guided-manual-tests/run-all.sh" "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=guided-manual-tests/common.sh
source "$SCRIPT_DIR/common.sh"

cleanup() {
	echo "[Manual tests] Cleaning up Docker Compose stack"
	compose_cmd down -v --remove-orphans
}
trap cleanup EXIT

echo "[Manual tests] Running guided scripts in sequence"
"$SCRIPT_DIR/a-setup-environment.sh"
"$SCRIPT_DIR/b-seed-databases.sh"
"$SCRIPT_DIR/c-produce-changes-in-source.sh"
"$SCRIPT_DIR/d-produce-diff-json.sh"
"$SCRIPT_DIR/e-dump-databases-before-apply.sh"
printf 'apply\n' | "$SCRIPT_DIR/f-apply-changes.sh"
"$SCRIPT_DIR/g-final-dump-and-verify.sh"

echo "[Manual tests] PASS"
