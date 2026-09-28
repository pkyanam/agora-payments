#!/usr/bin/env bash
# Prerelease bootstrap for Agora Community. Source access is through the user's
# GitHub CLI session; this script never embeds tokens or removes Docker state.
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  printf '%s\n' 'Install GitHub CLI (gh), then authenticate with `gh auth login` and retry.' >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  printf '%s\n' 'Agora Community source is private during prerelease. Run `gh auth login` with repository access, then retry.' >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agora-community.XXXXXX")"
chmod 700 "$TMP_DIR"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT INT TERM
SOURCE_DIR="$TMP_DIR/source"
gh repo clone pkyanam/agora-payments "$SOURCE_DIR"
bash "$SOURCE_DIR/install.sh" "$@"
