#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
	echo "Usage: $0 <command> [args...]" >&2
	exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENVRC_PATH="$REPO_ROOT/.envrc"
BACKUP_PATH="$REPO_ROOT/.envrc.original"
preserved_envrc=0

restore_envrc() {
	local exit_code=$?
	trap - EXIT INT TERM

	if [ "$preserved_envrc" -eq 1 ] && [ -e "$BACKUP_PATH" ]; then
		rm -f "$ENVRC_PATH"
		mv "$BACKUP_PATH" "$ENVRC_PATH"
	fi

	exit "$exit_code"
}

if [ -e "$BACKUP_PATH" ]; then
	echo "Refusing to overwrite existing backup: $BACKUP_PATH" >&2
	exit 1
fi

if [ -e "$ENVRC_PATH" ]; then
	mv "$ENVRC_PATH" "$BACKUP_PATH"
	preserved_envrc=1
fi

trap restore_envrc EXIT INT TERM

FRG_ENVRC_PRESERVED=1 "$@"
