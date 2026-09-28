#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agora-boat-installer-test.XXXXXX")"
trap 'if [[ -f "$TEST_DIR/state/server.pid" ]]; then kill "$(cat "$TEST_DIR/state/server.pid")" 2>/dev/null || true; fi; rm -rf -- "$TEST_DIR"' EXIT INT TERM

MOCK_BIN="$TEST_DIR/bin"
STATE="$TEST_DIR/state"
HOME="$TEST_DIR/home"
mkdir -p "$MOCK_BIN" "$STATE" "$HOME"
export HOME TEST_STATE="$STATE" TEST_LOG="$STATE/events.log"
REAL_NODE="$(command -v node)"
export REAL_NODE
PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
PORT2="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
EMAIL="owner.o'brien+boat@example.com;touch\${IFS}$TEST_STATE/injected"
COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
export MOCK_COMMIT="$COMMIT"

cat > "$MOCK_BIN/boat" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  status) exit 0 ;;
  new)
    printf 'new %s\n' "${*:2}" >> "$TEST_LOG"
    printf '{"sandbox":{"id":"bx_test123"}}\n'
    ;;
  info)
    [[ "$2" == bx_test123 ]]
    printf '{"id":"bx_test123","state":"ready"}\n'
    ;;
  ssh)
    id="$2"; shift 2
    [[ "$id" == bx_test123 && "$1" == -- ]]
    shift
    printf 'ssh %s\n' "$id" >> "$TEST_LOG"
    exec "$@"
    ;;
  new|resume|extend|delete)
    printf 'unexpected boat mutation: %s\n' "$1" >&2
    exit 91
    ;;
  *) printf 'unexpected boat command: %s\n' "$1" >&2; exit 92 ;;
esac
MOCK

cat > "$MOCK_BIN/git" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == -C ]]; then
  if [[ "$3" == rev-parse && "$4" == HEAD ]]; then printf '%s\n' "$MOCK_COMMIT"; exit 0; fi
fi
if [[ "$1" == clone ]]; then
  dest="${@: -1}"
  mkdir -p "$dest/.git"
  cat > "$dest/install.sh" <<'INSTALL'
#!/usr/bin/env bash
set -euo pipefail
dir= port= host= origin= email=
while (($#)); do
  case "$1" in
    --target) shift 2 ;;
    --non-interactive) shift ;;
    --owner-email) email="$2"; shift 2 ;;
    --dir) dir="$2"; shift 2 ;;
    --url) origin="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --host) host="$2"; shift 2 ;;
    *) printf 'unexpected mock install argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done
node - "$dir" "$port" "$host" "$origin" "$email" <<'NODE'
const fs=require('node:fs');const [dir,port,host,origin,email]=process.argv.slice(2);fs.mkdirSync(`${dir}/releases/abcdef123456`,{recursive:true});fs.mkdirSync(`${dir}/state/data`,{recursive:true});fs.mkdirSync(`${dir}/state/backups`,{recursive:true});
fs.writeFileSync(`${dir}/install.json`,JSON.stringify({format:1,deployment_target:'node',repository:'pkyanam/agora-payments',port:Number(port),host,public_origin:origin,owner_email:email,current_version:'abcdef123456'})+'\n');
fs.symlinkSync('releases/abcdef123456',`${dir}/current`);
fs.writeFileSync(`${dir}/state/.env.local`,'test-only-env\n',{mode:0o600});
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(`${dir}/state/data/agora.sqlite`);db.exec('CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES (\'old\')');db.close();
fs.writeFileSync(`${dir}/start.sh`,'#!/usr/bin/env bash\nexit 0\n',{mode:0o700});
fs.writeFileSync(`${dir}/releases/abcdef123456/start.sh`,'#!/usr/bin/env bash\nexit 0\n',{mode:0o700});
fs.writeFileSync(`${dir}/releases/abcdef123456/update.sh`,'#!/usr/bin/env bash\nprintf "update\\n" >> "$TEST_LOG"\nif [[ "${TEST_UPDATE_MODE:-}" == failure ]]; then\n node - "$TEST_APP_DIR" <<\'NODE\'\nconst fs=require("node:fs");const {DatabaseSync}=require("node:sqlite");const d=process.argv[2];const db=new DatabaseSync(`${d}/state/data/agora.sqlite`);db.prepare(`UPDATE marker SET value=?`).run("new");db.close();fs.mkdirSync(`${d}/releases/badbadbadbad`,{recursive:true});fs.copyFileSync(`${d}/start.sh`,`${d}/releases/badbadbadbad/start.sh`);fs.copyFileSync(`${d}/update.sh`,`${d}/releases/badbadbadbad/update.sh`);fs.unlinkSync(`${d}/current`);fs.symlinkSync("releases/badbadbadbad",`${d}/current`);const m=JSON.parse(fs.readFileSync(`${d}/install.json`));m.current_version="badbadbadbad";fs.writeFileSync(`${d}/install.json`,JSON.stringify(m));\nNODE\nfi\n',{mode:0o700});
fs.copyFileSync(`${dir}/releases/abcdef123456/start.sh`,`${dir}/start.sh`);fs.copyFileSync(`${dir}/releases/abcdef123456/update.sh`,`${dir}/update.sh`);
NODE
printf 'mock install finished\n'
INSTALL
  chmod +x "$dest/install.sh"
  exit 0
fi
if [[ "$1" == -C && "$3" == fetch ]]; then exit 0; fi
if [[ "$1" == -C && "$3" == checkout ]]; then exit 0; fi
if [[ "$1" == -C && "$3" == rev-parse && "$4" == HEAD ]]; then printf '%s\n' "$MOCK_COMMIT"; exit 0; fi
printf 'unexpected git call: %s\n' "$*" >&2
exit 93
MOCK

cat > "$MOCK_BIN/npm" <<'MOCK'
#!/usr/bin/env bash
printf 'npm %s\n' "$*" >> "$TEST_LOG"
exit 0
MOCK

cat > "$MOCK_BIN/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >> "$TEST_LOG"
cat <<'INSTALL'
mkdir -p "$HOME/.local/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$HOME/.local/bin/agora"
chmod +x "$HOME/.local/bin/agora"
INSTALL
MOCK

cat > "$MOCK_BIN/node" <<'MOCK'
#!/usr/bin/env bash
exec "$REAL_NODE" "$@"
MOCK

cat > "$MOCK_BIN/sudo" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == -n ]] && shift
if [[ "$1" == true ]]; then exit 0; fi
if [[ "$1" == tee ]]; then
  shift
  [[ "$1" == /etc/systemd/system/agora-community.service ]]
  cat > "$TEST_STATE/service.unit"
  exit 0
fi
exec "$@"
MOCK

cat > "$MOCK_BIN/systemctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
cmd="$1"; shift
printf 'systemctl %s\n' "$cmd" >> "$TEST_LOG"
case "$cmd" in
  daemon-reload|enable) exit 0 ;;
  is-active) exit 1 ;;
  start|restart)
    if [[ -f "$TEST_STATE/server.pid" ]] && kill -0 "$(cat "$TEST_STATE/server.pid")" 2>/dev/null; then kill "$(cat "$TEST_STATE/server.pid")"; wait "$(cat "$TEST_STATE/server.pid")" 2>/dev/null || true; fi
    "$REAL_NODE" "$TEST_STATE/server.js" "$AGORA_REMOTE_PORT" >> "$TEST_STATE/server.log" 2>&1 &
    echo "$!" > "$TEST_STATE/server.pid"
    ;;
  stop)
    if [[ -f "$TEST_STATE/server.pid" ]] && kill -0 "$(cat "$TEST_STATE/server.pid")" 2>/dev/null; then kill "$(cat "$TEST_STATE/server.pid")"; fi
    rm -f "$TEST_STATE/server.pid"
    ;;
  *) printf 'unexpected systemctl action %s\n' "$cmd" >&2; exit 94 ;;
esac
MOCK

cat > "$MOCK_BIN/sleep" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK

cat > "$MOCK_BIN/host" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --help ]]; then printf 'host PORT [--public] ; host hide PORT\n'; exit 0; fi
if [[ "$1" == hide ]]; then printf 'host hide\n' >> "$TEST_LOG"; exit 0; fi
port="$1"
if [[ "${2:-}" == --public ]]; then
  "$REAL_NODE" -e 'fetch(`http://127.0.0.1:${process.argv[1]}/api/health`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' "$port"
  printf 'host public\n' >> "$TEST_LOG"
  printf 'https://bx-test-123-%s.on.boat.dev\n' "$port"
else
  printf 'host private\n' >> "$TEST_LOG"
  printf 'https://bx-test-123-%s.on.boat.dev?_token=mock-private-token\n' "$port"
fi
MOCK

cat > "$STATE/server.js" <<'SERVER'
const http=require('node:http'),fs=require('node:fs');const port=Number(process.argv[2]),dir=process.env.TEST_APP_DIR;
http.createServer((req,res)=>{if(req.url==='/api/health'){const m=JSON.parse(fs.readFileSync(`${dir}/install.json`));res.writeHead(m.current_version==='badbadbadbad'?503:200,{'content-type':'application/json'});res.end(JSON.stringify({deployment_target:'node',current_version:m.current_version}));return;}res.end('ok');}).listen(port,'0.0.0.0');
SERVER
chmod +x "$MOCK_BIN"/*
export PATH="$MOCK_BIN:/usr/bin:/bin:$PATH"
export TEST_APP_DIR="$HOME/agora-install"

OUTPUT="$(bash "$ROOT/install.sh" --target boat --boat-id bx_test123 --owner-email "$EMAIL" --dir "$HOME/agora-install" --port "$PORT" --non-interactive)"
[[ "$OUTPUT" == *"https://bx-test-123-$PORT.on.boat.dev"* ]]
[[ "$OUTPUT" != *mock-private-token* && "$OUTPUT" != *"Password:"* ]]
[[ ! -e "$STATE/injected" ]]
[[ "$(cat "$HOME/agora-install/install.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).owner_email))')" == "$EMAIL" ]]
[[ "$(grep -n '^host private$' "$TEST_LOG" | cut -d: -f1)" -lt "$(grep -n '^systemctl start$' "$TEST_LOG" | cut -d: -f1)" ]]
[[ "$(grep -n '^systemctl start$' "$TEST_LOG" | cut -d: -f1)" -lt "$(grep -n '^host public$' "$TEST_LOG" | cut -d: -f1)" ]]

first_installs="$(grep -c '^npm ' "$TEST_LOG" || true)"
OUTPUT="$(bash "$ROOT/install.sh" --target boat --boat-id bx_test123 --owner-email "$EMAIL" --dir "$HOME/agora-install" --port "$PORT" --non-interactive)"
[[ "$OUTPUT" == *"https://bx-test-123-$PORT.on.boat.dev"* ]]
[[ "$(grep -c '^npm ' "$TEST_LOG" || true)" == "$first_installs" ]]

before_update="$(wc -l < "$TEST_LOG" | tr -d ' ')"
bash "$ROOT/install.sh" --target boat --boat-id bx_test123 --owner-email "$EMAIL" --dir "$HOME/agora-install" --port "$PORT" --non-interactive --update >/dev/null
tail -n "+$((before_update + 1))" "$TEST_LOG" > "$STATE/update-events.log"
[[ "$(grep -n '^systemctl stop$' "$STATE/update-events.log" | cut -d: -f1)" -lt "$(grep -n '^update$' "$STATE/update-events.log" | cut -d: -f1)" ]]
[[ "$(grep -n '^update$' "$STATE/update-events.log" | cut -d: -f1)" -lt "$(grep -n '^systemctl start$' "$STATE/update-events.log" | tail -1 | cut -d: -f1)" ]]

if TEST_UPDATE_MODE=failure bash "$ROOT/install.sh" --target boat --boat-id bx_test123 --owner-email "$EMAIL" --dir "$HOME/agora-install" --port "$PORT" --non-interactive --update > "$STATE/failed-update.out" 2>&1; then
  printf '%s\n' 'Expected unhealthy update to report failure after restoring the previous release.' >&2
  exit 1
fi
[[ "$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1])).current_version)' "$HOME/agora-install/install.json")" == abcdef123456 ]]
[[ "$(readlink "$HOME/agora-install/current")" == releases/abcdef123456 ]]
[[ "$(node --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const d=new DatabaseSync(process.argv[1]); console.log(d.prepare("SELECT value FROM marker").get().value); d.close()' "$HOME/agora-install/state/data/agora.sqlite")" == old ]]
grep -q 'previous release and database were restored and verified' "$STATE/failed-update.out"

if bash "$ROOT/install.sh" --target boat --boat-id bx_test123 --owner-email "$EMAIL" --non-interactive --no-auto-stop > "$STATE/no-auto-stop-existing.out" 2>&1; then
  printf '%s\n' 'Expected --no-auto-stop on an existing sandbox to fail or explicitly extend it.' >&2
  exit 1
fi

create_home="$TEST_DIR/create-home"
mkdir -p "$create_home"
HOME="$create_home" bash "$ROOT/install.sh" --target boat --create-boat --owner-email "$EMAIL" --port "$PORT2" --non-interactive > "$STATE/create.out"
new_args="$(sed -n 's/^new //p' "$TEST_LOG" | tail -1)"
[[ "$new_args" == *'--ttl 3600'* && "$new_args" != *'--no-auto-stop'* && "$new_args" == *'--no-env'* ]]

if bash "$ROOT/install.sh" --target boat --boat-id 'bad;touch /tmp/not-a-sandbox' --owner-email "$EMAIL" --non-interactive > "$STATE/bad-id.out" 2>&1; then
  printf '%s\n' 'Expected malformed sandbox id to fail.' >&2
  exit 1
fi
if bash "$ROOT/install.sh" --target boat --boat-id bx_test123 --owner-email 'not-an-email' --non-interactive > "$STATE/bad-email.out" 2>&1; then
  printf '%s\n' 'Expected malformed owner email to fail.' >&2
  exit 1
fi

printf '%s\n' 'PASS: Boat target dispatch, argument safety, private-to-public route order, rerun idempotency, update lifecycle, default timed creation, and validation (all Boat calls mocked).'
