#!/usr/bin/env bash
# Install Agora Community from its public GitHub repository.
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  printf '%s\n' 'Install Git, then run this installer again.' >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agora-community.XXXXXX")"
chmod 700 "$TMP_DIR"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT INT TERM
SOURCE_DIR="$TMP_DIR/source"
if ! git clone --depth 1 https://github.com/pkyanam/agora-payments.git "$SOURCE_DIR"; then
  printf '%s\n' 'Could not download Agora Community from GitHub. Check your internet connection and retry.' >&2
  exit 1
fi
bash "$SOURCE_DIR/install.sh" "$@"
