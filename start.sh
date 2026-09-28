#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${AGORA_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)}"
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd -P)"
[[ -f "$INSTALL_DIR/install.json" && -L "$INSTALL_DIR/current" ]] || { printf 'No Agora Community install at %s\n' "$INSTALL_DIR" >&2; exit 1; }
[[ ! -L "$INSTALL_DIR/install.json" && ! -L "$INSTALL_DIR/state" && ! -L "$INSTALL_DIR/state/.env.local" && ! -L "$INSTALL_DIR/state/data" && ! -L "$INSTALL_DIR/state/data/agora.sqlite" ]] || { printf '%s\n' 'Refusing a symlink in a critical Agora state path.' >&2; exit 1; }
CURRENT_REL="$(readlink "$INSTALL_DIR/current")"
[[ "$CURRENT_REL" =~ ^releases/[0-9a-f]{12}$ ]] || { printf '%s\n' 'The active release link is outside the managed releases directory.' >&2; exit 1; }
CURRENT_DIR="$(cd "$INSTALL_DIR/$CURRENT_REL" && pwd -P)"
[[ "$CURRENT_DIR" == "$INSTALL_DIR"/releases/* ]] || { printf '%s\n' 'The active release resolves outside the installation.' >&2; exit 1; }
[[ "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).current_version' "$INSTALL_DIR/install.json")" == "${CURRENT_REL#releases/}" ]] || { printf '%s\n' 'Install manifest does not match the active release.' >&2; exit 1; }
PORT="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).port' "$INSTALL_DIR/install.json")"
HOST="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).host' "$INSTALL_DIR/install.json")"
cd "$INSTALL_DIR/current"
PID_FILE="$INSTALL_DIR/state/server.pid"
[[ ! -L "$PID_FILE" ]] || { printf '%s\n' 'Refusing a symlink in a critical Agora state path.' >&2; exit 1; }
process_cwd() {
  if [[ -d "/proc/$1" ]]; then readlink -f "/proc/$1/cwd" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'
  fi
}
process_identity() {
  local uid command
  uid="$(ps -p "$1" -o uid= 2>/dev/null | tr -d ' ')"
  command="$(ps -p "$1" -o command= 2>/dev/null || true)"
  [[ "$uid" == "$(id -u)" && ( "$command" == *"$INSTALL_DIR/current/node_modules/next/dist/bin/next start"* || "$command" == *"next-server (v"* || "$command" == *"/next-server"* ) ]]
}
if [[ -e "$PID_FILE" ]]; then
  [[ -f "$PID_FILE" ]] || { printf '%s\n' 'The Agora PID path is not a regular file.' >&2; exit 1; }
  OLD_PID="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pid' "$PID_FILE" 2>/dev/null || true)"
  RECORDED_START="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).start_time' "$PID_FILE" 2>/dev/null || true)"
  RECORDED_CWD="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).workdir' "$PID_FILE" 2>/dev/null || true)"
  if [[ "${OLD_PID:-}" =~ ^[0-9]+$ ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    ACTUAL_START="$(ps -p "$OLD_PID" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//')"
    ACTUAL_CWD="$(process_cwd "$OLD_PID")"
    if [[ "$ACTUAL_START" == "$RECORDED_START" && "$ACTUAL_CWD" == "$RECORDED_CWD" && "$ACTUAL_CWD" == "$INSTALL_DIR"/releases/* ]] && process_identity "$OLD_PID"; then
      printf 'Agora already appears to be running (pid %s). Stop it before starting another copy.\n' "$OLD_PID" >&2
      exit 1
    fi
    printf 'The recorded PID is active but cannot be proven to be this Agora instance. Inspect %s before starting.\n' "$PID_FILE" >&2
    exit 1
  else
    rm -f "$PID_FILE"
  fi
fi
START_TIME="$(ps -p "$$" -o lstart= | sed 's/^[[:space:]]*//')"
WORKDIR="$(pwd -P)"
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({pid:Number(process.argv[2]),start_time:process.argv[3],workdir:process.argv[4],uid:Number(process.argv[5])})+"\n",{mode:0o600})' "$PID_FILE" "$$" "$START_TIME" "$WORKDIR" "$(id -u)"
trap 'rm -f "$PID_FILE"' EXIT INT TERM
exec node "$INSTALL_DIR/current/node_modules/next/dist/bin/next" start --hostname "$HOST" --port "$PORT"
