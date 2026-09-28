#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agora-installer-port-test.XXXXXX")"
LISTENER_PID=
cleanup() {
  [[ -z "$LISTENER_PID" ]] || kill "$LISTENER_PID" 2>/dev/null || true
  rm -rf -- "$TEST_DIR"
}
trap cleanup EXIT INT TERM
port_available() {
  node -e 'const s=require("node:net").createServer();s.once("error",()=>process.exit(1));s.listen({host:"127.0.0.1",port:3000},()=>s.close(()=>process.exit(0)))' >/dev/null 2>&1
}
if port_available; then
  node -e 'require("node:net").createServer().listen(3000,"127.0.0.1")' >/dev/null 2>&1 &
  LISTENER_PID=$!
  for _ in {1..30}; do
    kill -0 "$LISTENER_PID" 2>/dev/null || { printf '%s\n' 'Could not start test listener on port 3000.' >&2; exit 1; }
    if ! port_available; then break; fi
    sleep 0.05
  done
fi
if port_available; then printf '%s\n' 'Could not occupy port 3000 for installer regression test.' >&2; exit 1; fi

git clone --quiet --shared "$ROOT" "$TEST_DIR/source"
mkdir -p "$TEST_DIR/bin"
cat > "$TEST_DIR/bin/npm" <<'NPM'
#!/usr/bin/env bash
case "$*" in
  'install --no-audit --no-fund --no-package-lock'|'run build') exit 0 ;;
  *) printf 'Unexpected npm invocation: %s\n' "$*" >&2; exit 1 ;;
esac
NPM
chmod 755 "$TEST_DIR/bin/npm"
export PATH="$TEST_DIR/bin:$PATH"

bash "$TEST_DIR/source/install.sh" --dir "$TEST_DIR/default" --non-interactive --owner-email owner@example.com > "$TEST_DIR/install.out"
node --input-type=module - "$TEST_DIR/default/install.json" "$TEST_DIR/default/state/.env.local" <<'NODE'
import { readFile } from 'node:fs/promises';
const [manifestPath,envPath]=process.argv.slice(2);const m=JSON.parse(await readFile(manifestPath,'utf8'));const env=await readFile(envPath,'utf8');
if(m.port===3000||m.public_origin!==`http://localhost:${m.port}`||!env.includes(`AGORA_PUBLIC_ORIGIN="${m.public_origin}"`))throw new Error('Default installation did not persist a coherent free port and public origin.');
NODE
printf '%s\n' 'PASS: a busy default port selects and persists a free matching public origin.'

if bash "$TEST_DIR/source/install.sh" --dir "$TEST_DIR/explicit" --non-interactive --owner-email owner@example.com --port 3000 > "$TEST_DIR/explicit.out" 2>&1; then
  printf '%s\n' 'Installer unexpectedly accepted an occupied explicit port.' >&2; exit 1
fi
grep -Fq 'Port 3000 is already in use.' "$TEST_DIR/explicit.out"
[[ ! -e "$TEST_DIR/explicit/install.json" ]]
printf '%s\n' 'PASS: an occupied explicit port fails before install/build and is not changed.'
