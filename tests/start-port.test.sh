#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agora-start-port-test.XXXXXX")"
trap '[[ -z "${LISTENER_PID:-}" ]] || kill "$LISTENER_PID" 2>/dev/null || true; rm -rf -- "$TEST_DIR"' EXIT INT TERM
APP="$TEST_DIR/app"
mkdir -p "$APP/releases/0123456789ab" "$APP/state"
ln -s releases/0123456789ab "$APP/current"
printf '{"install_dir":"%s","current_version":"0123456789ab","port":0,"host":"127.0.0.1"}\n' "$APP" > "$APP/install.json"
PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
node -e 'require("node:net").createServer().listen(Number(process.argv[1]),"127.0.0.1")' "$PORT" >/dev/null 2>&1 &
LISTENER_PID=$!
for _ in {1..30}; do
  if ! kill -0 "$LISTENER_PID" 2>/dev/null; then printf '%s\n' 'Test listener failed to start.' >&2; exit 1; fi
  if ! node -e 'const s=require("node:net").createServer();s.once("error",()=>process.exit(1));s.listen({host:"127.0.0.1",port:Number(process.argv[1])},()=>s.close(()=>process.exit(0)))' "$PORT" >/dev/null 2>&1; then break; fi
  sleep 0.05
done
sed -i.bak "s/\"port\":0/\"port\":$PORT/" "$APP/install.json"
OUTPUT="$(AGORA_INSTALL_DIR="$APP" bash "$ROOT/start.sh" 2>&1)" && { printf '%s\n' 'start.sh unexpectedly accepted an occupied port.' >&2; exit 1; }
[[ "$OUTPUT" == *"127.0.0.1:$PORT is already in use"* ]]
[[ "$OUTPUT" == *"lsof -nP -iTCP:$PORT -sTCP:LISTEN"* ]]
kill -0 "$LISTENER_PID"
printf '%s\n' 'PASS: startup explains an occupied port and leaves its listener running.'
OUTPUT="$(AGORA_INSTALL_DIR="$APP" bash "$ROOT/install.sh" --dir "$APP" --non-interactive --owner-email test@example.com)"
[[ "$OUTPUT" == *'is already installed'* ]]
printf '%s\n' 'PASS: installer reruns remain idempotent when the configured port is occupied.'
