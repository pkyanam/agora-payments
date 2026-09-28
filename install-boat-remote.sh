#!/usr/bin/env bash
# Runs inside the selected Boat VM, sent over `boat ssh` by install-boat.sh.
set -euo pipefail

decode_b64() { printf '%s' "$1" | base64 -d; }
APP_DIR="${AGORA_REMOTE_DIR:-}"
if [[ -n "${AGORA_REMOTE_DIR_B64:-}" ]]; then APP_DIR="$(decode_b64 "$AGORA_REMOTE_DIR_B64")"; fi
APP_DIR="${APP_DIR:-${HOME:?HOME is required}/.local/share/agora}"
PORT="${AGORA_REMOTE_PORT:-3000}"
PORT_EXPLICIT="${AGORA_REMOTE_PORT_EXPLICIT:-0}"
OWNER_EMAIL="${AGORA_REMOTE_OWNER_EMAIL:-}"
if [[ -n "${AGORA_REMOTE_OWNER_EMAIL_B64:-}" ]]; then OWNER_EMAIL="$(decode_b64 "$AGORA_REMOTE_OWNER_EMAIL_B64")"; fi
UPDATE="${AGORA_REMOTE_UPDATE:-0}"
SOURCE_COMMIT="${AGORA_SOURCE_COMMIT:-}"
SERVICE=agora-community.service
TEMP_DIR=""
TEMP_PID=""
ROUTE_PENDING=0
PUBLISHED=0
SUDO=()

fail() { printf 'Agora Boat setup: %s\n' "$1" >&2; exit 1; }
cleanup() {
  if [[ -n "$TEMP_PID" ]]; then kill "$TEMP_PID" 2>/dev/null || true; wait "$TEMP_PID" 2>/dev/null || true; fi
  [[ -z "$TEMP_DIR" ]] || rm -rf "$TEMP_DIR"
  if ((ROUTE_PENDING && !PUBLISHED)); then host hide "$PORT" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM

[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT > 0 && PORT < 65536)) || fail 'Invalid service port.'
[[ "$APP_DIR" == /* && "$APP_DIR" != *[[:space:]]* ]] || fail 'The remote installation path must be absolute and contain no spaces.'
[[ -z "$SOURCE_COMMIT" || "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid installer source revision.'
command -v node >/dev/null 2>&1 || fail 'This sandbox needs Node.js 22.16 or newer.'
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&(b>16||(b===16&&c>=0)))?0:1)' || fail "Agora needs Node.js 22.16 or newer; found $(node --version)."
command -v npm >/dev/null 2>&1 || fail 'npm is required in the Boat sandbox.'
command -v git >/dev/null 2>&1 || fail 'Git is required in the Boat sandbox.'
command -v curl >/dev/null 2>&1 || fail 'curl is required in the Boat sandbox.'
command -v host >/dev/null 2>&1 || fail 'Boat host command is missing inside this sandbox.'
host_help="$(host --help 2>&1 || true)"
[[ "$host_help" == *"--public"* && "$host_help" == *"hide"* ]] || fail 'The Boat host CLI is unavailable or incomplete inside this sandbox.'
command -v systemctl >/dev/null 2>&1 || fail 'This Boat sandbox does not provide systemd; Agora cannot be configured to restart after resume.'
if ((EUID != 0)); then
  sudo -n true 2>/dev/null || fail 'Passwordless sudo is required to install an always-on systemd service in this Boat sandbox.'
  SUDO=(sudo -n)
fi

port_health() {
  node --input-type=module - "$PORT" "$APP_DIR/install.json" <<'NODE'
import { readFile } from 'node:fs/promises';
const port=Number(process.argv[2]),manifest=JSON.parse(await readFile(process.argv[3],'utf8'));
try { const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)});if(!r.ok)process.exit(1);const j=await r.json();process.exit(j.deployment_target==='node'&&j.current_version===manifest.current_version?0:1); } catch { process.exit(1); }
NODE
}
port_is_listening() {
  node -e 'const s=require("node:net").connect(Number(process.argv[1]),"127.0.0.1",()=>{s.end();process.exit(0)});s.on("error",()=>process.exit(1))' "$PORT" >/dev/null 2>&1
}
install_agora_cli() {
  if [[ -f "$HOME/.local/bin/agora" ]] && grep -Fqx '// Agora managed CLI (pkyanam/agora-cli)' "$HOME/.local/bin/agora"; then
    export PATH="$HOME/.local/bin:$PATH"
    return 0
  fi
  printf 'Installing the Agora command-line tool in this Boat sandbox...\n'
  curl -fsSL https://raw.githubusercontent.com/pkyanam/agora-cli/main/install.sh | bash || return 1
  export PATH="$HOME/.local/bin:$PATH"
  command -v agora >/dev/null 2>&1
}
wait_for_health() {
  for _ in {1..60}; do
    if port_health; then return 0; fi
    sleep 1
  done
  return 1
}
route_origin() {
node --input-type=module - "$1" "$PORT" 2>/dev/null <<'NODE'
const raw=process.argv[2],port=process.argv[3];
const urls=raw.match(/https:\/\/[A-Za-z0-9.-]+\.on\.(?:ascii|boat)\.dev(?:\/[^\s]*)?/g)||[];
if(urls.length===0)throw new Error('Boat host did not return a public HTTPS URL.');
const u=new URL(urls[urls.length-1]);
const suffix=['.on.ascii.dev','.on.boat.dev'].find(s=>u.hostname.endsWith(`-${port}${s}`));
if(u.protocol!=='https:'||u.username||u.password||!suffix||u.hostname.length<=suffix.length+String(port).length+1||u.pathname!=='/'||u.hash)throw new Error('Boat returned a URL that does not match the requested host port.');
console.log(u.origin);
NODE
}
host_publicly() {
  local output origin
  host "$PORT" --public >/dev/null 2>&1 || fail 'Boat could not enable the public HTTPS route.'
  output="$(host url "$PORT" --timeout 30 --public 2>&1)" || { host hide "$PORT" >/dev/null 2>&1 || true; fail 'Boat could not confirm that its public HTTPS route is ready.'; }
  origin="$(route_origin "$output")" || { host hide "$PORT" >/dev/null 2>&1 || true; fail 'Boat returned an unexpected public URL; the route was hidden.'; }
  [[ "$origin" == "$PUBLIC_ORIGIN" ]] || { host hide "$PORT" >/dev/null 2>&1 || true; fail 'Boat host URL changed unexpectedly; the route was hidden.'; }
  [[ "$output" != *"_token="* ]] || { host hide "$PORT" >/dev/null 2>&1 || true; fail 'Boat returned a token-gated URL after public access was requested; the route was hidden.'; }
  ROUTE_PENDING=0
  PUBLISHED=1
  printf 'Agora is hosted at %s\n' "$origin"
}
write_service() {
  local user="$1" node_dir service_path
  node_dir="$(dirname "$(command -v node)")"
  service_path="$node_dir:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  [[ "$service_path" != *[[:space:]]* ]] || fail 'The Node.js service path contains whitespace and cannot be used safely in systemd.'
  "${SUDO[@]}" tee "/etc/systemd/system/$SERVICE" >/dev/null <<UNIT
[Unit]
Description=Agora Community payments server
After=network.target

[Service]
Type=simple
User=$user
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/start.sh
Environment=PATH=$service_path
Restart=always
RestartSec=3
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
UNIT
  "${SUDO[@]}" systemctl daemon-reload
  "${SUDO[@]}" systemctl enable "$SERVICE" >/dev/null
}
restore_old_release() {
  local rollback_dir="$1" old_release="$2" database="$APP_DIR/state/data/agora.sqlite"
  "${SUDO[@]}" systemctl stop "$SERVICE" >/dev/null 2>&1 || true
  if "${SUDO[@]}" systemctl is-active --quiet "$SERVICE" || port_is_listening; then
    fail "The failed Agora process is still running. Rollback files are preserved at $rollback_dir; stop it before restoring data."
  fi
  cp "$rollback_dir/install.json" "$APP_DIR/install.json"
  cp "$rollback_dir/.env.local" "$APP_DIR/state/.env.local"
  chmod 600 "$APP_DIR/install.json" "$APP_DIR/state/.env.local"
  node --input-type=module - "$APP_DIR/current" "$old_release" <<'NODE'
import { rename, symlink } from 'node:fs/promises';
const current=process.argv[2],release=process.argv[3],next=`${current}.boat-rollback-${process.pid}`;
await symlink(release,next);await rename(next,current);
NODE
  cp "$APP_DIR/$old_release/start.sh" "$APP_DIR/start.sh"
  cp "$APP_DIR/$old_release/update.sh" "$APP_DIR/update.sh"
  chmod 700 "$APP_DIR/start.sh" "$APP_DIR/update.sh"
  if [[ -f "$rollback_dir/agora.sqlite" ]]; then
    rm -f "$database-wal" "$database-shm" "$database-journal"
    cp "$rollback_dir/agora.sqlite" "$database.restore"
    chmod 600 "$database.restore"
    mv -f "$database.restore" "$database"
  else
    rm -f "$database" "$database-wal" "$database-shm" "$database-journal"
  fi
}
update_with_rollback() {
  local rollback_dir old_release update_result=0
  if ! host hide "$PORT" >/dev/null 2>&1; then
    fail 'Boat could not hide the public route before update; the existing deployment was not changed.'
  fi
  if ! "${SUDO[@]}" systemctl stop "$SERVICE"; then
    if "${SUDO[@]}" systemctl start "$SERVICE" >/dev/null 2>&1 && wait_for_health; then host_publicly; fi
    fail 'systemd could not stop Agora cleanly; no update was attempted.'
  fi
  if "${SUDO[@]}" systemctl is-active --quiet "$SERVICE" || port_is_listening; then
    fail 'Agora did not stop cleanly; the public route remains hidden and no update was attempted.'
  fi
  old_release="$(readlink "$APP_DIR/current")"
  [[ "$old_release" =~ ^releases/[0-9a-f]{12}$ ]] || fail 'The current Agora release link is invalid; the public route remains hidden and no update was attempted.'
  rollback_dir="$(mktemp -d "$APP_DIR/state/backups/.boat-update-rollback.XXXXXX")"
  chmod 700 "$rollback_dir"
  cp "$APP_DIR/install.json" "$rollback_dir/install.json"
  cp "$APP_DIR/state/.env.local" "$rollback_dir/.env.local"
  chmod 600 "$rollback_dir/install.json" "$rollback_dir/.env.local"
  if [[ -f "$APP_DIR/state/data/agora.sqlite" ]]; then
    if ! node --input-type=module - "$APP_DIR/state/data/agora.sqlite" "$rollback_dir/agora.sqlite" <<'NODE'
import { chmod } from 'node:fs/promises';
import { DatabaseSync, backup } from 'node:sqlite';
const db=new DatabaseSync(process.argv[2]);try{await backup(db,process.argv[3]);}finally{db.close();}await chmod(process.argv[3],0o600);
NODE
    then
      "${SUDO[@]}" systemctl start "$SERVICE" >/dev/null 2>&1 || fail "Could not snapshot the database or restart Agora. Route remains hidden; recovery files are at $rollback_dir."
      wait_for_health || fail "Could not snapshot the database and the old release did not recover. Route remains hidden; recovery files are at $rollback_dir."
      host_publicly
      fail "Could not snapshot the Agora database. The old deployment was restored; no update was attempted. Recovery files are at $rollback_dir."
    fi
  fi
  if ! "$APP_DIR/update.sh" --dir "$APP_DIR"; then
    update_result=1
  else
    if "${SUDO[@]}" systemctl start "$SERVICE" && wait_for_health; then
      host_publicly
      rm -rf "$rollback_dir"
      return 0
    fi
    update_result=1
  fi
  restore_old_release "$rollback_dir" "$old_release"
  "${SUDO[@]}" systemctl start "$SERVICE" || fail "Could not restart restored Agora release. Recovery snapshot is preserved at $rollback_dir."
  wait_for_health || fail "Restored Agora release did not become healthy. Recovery snapshot is preserved at $rollback_dir."
  host_publicly
  rm -rf "$rollback_dir"
  return "$update_result"
}
read_manifest() {
  node --input-type=module - "$APP_DIR/install.json" "$PORT" "$PORT_EXPLICIT" <<'NODE'
import { readFile } from 'node:fs/promises';
const m=JSON.parse(await readFile(process.argv[2],'utf8'));
if(m.format!==1||m.deployment_target!=='node'||m.repository!=='pkyanam/agora-payments')throw new Error('Existing path is not an Agora Community Node installation.');
if(m.host!=='0.0.0.0')throw new Error('Existing Agora installation is not listening on 0.0.0.0.');
const selected=process.argv[3],explicit=process.argv[4]==='1';
if(explicit&&Number(selected)!==m.port)throw new Error(`Existing Agora installation uses port ${m.port}; rerun without --port or use that port.`);
console.log(JSON.stringify({port:m.port,origin:m.public_origin,owner_email:m.owner_email}));
NODE
}

if [[ -f "$APP_DIR/install.json" ]]; then
  existing="$(read_manifest)" || fail 'The existing Agora manifest is not compatible with Boat hosting.'
  PORT="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).port))' "$existing")"
  PUBLIC_ORIGIN="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).origin))' "$existing")"
  [[ "$PUBLIC_ORIGIN" == https://*.on.ascii.dev || "$PUBLIC_ORIGIN" == https://*.on.boat.dev ]] || fail 'The saved canonical origin is not a Boat HTTPS URL.'
  saved_email="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).owner_email))' "$existing")"
  if [[ -n "$OWNER_EMAIL" && "$OWNER_EMAIL" != "$saved_email" ]]; then fail 'Owner email differs from the existing installation; refusing to change its credentials.'; fi
  [[ -x "$APP_DIR/start.sh" && -x "$APP_DIR/update.sh" ]] || fail 'Existing installation is missing its managed start/update scripts.'
  write_service "$(id -un)"
  if [[ "$UPDATE" == 1 ]]; then
    update_with_rollback || fail 'Agora update failed; the previous release and database were restored and verified.'
  else
    "${SUDO[@]}" systemctl restart "$SERVICE"
    wait_for_health || fail "Agora did not become healthy on port $PORT; inspect `sudo journalctl -u $SERVICE`."
  fi
  host_publicly
  if ! install_agora_cli; then printf 'Warning: app is live, but the Agora CLI did not install. Retry inside the sandbox with the Agora CLI installer.\n' >&2; fi
  exit 0
fi

[[ "$UPDATE" != 1 ]] || fail 'No existing Boat Agora installation was found; refusing --update.'
[[ -n "$OWNER_EMAIL" ]] || fail 'Owner email is required for the first Boat installation.'
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail 'The local installer did not provide a pinned source revision.'
[[ ! -e "$APP_DIR" || ! -d "$APP_DIR" ]] || [[ -z "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail "Installation path $APP_DIR is not empty; refusing to overwrite it."

# Create the private Boat route while a harmless listener is bound, so its
# canonical HTTPS origin can be written into Agora before its first startup.
if ! node -e 'const net=require("node:net"),s=net.createServer();s.once("error",()=>process.exit(1));s.listen({host:"0.0.0.0",port:Number(process.argv[1]),exclusive:true},()=>s.close(()=>process.exit(0)))' "$PORT" >/dev/null 2>&1; then
  fail "Port $PORT is already in use. Stop its owner or choose a free --port."
fi
node -e 'require("node:http").createServer((_,r)=>{r.writeHead(503);r.end("Agora setup in progress");}).listen(Number(process.argv[1]),"0.0.0.0")' "$PORT" >/dev/null 2>&1 &
TEMP_PID=$!
ready=0
for _ in {1..20}; do
  if node -e 'const s=require("node:net").connect(Number(process.argv[1]),"127.0.0.1",()=>{s.end();process.exit(0)});s.on("error",()=>process.exit(1))' "$PORT" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.25
done
((ready)) || fail 'Could not prepare the temporary Boat host check.'
host "$PORT" --private >/dev/null 2>&1 || { host hide "$PORT" >/dev/null 2>&1 || true; fail 'Boat could not create a private host route.'; }
ROUTE_PENDING=1
private_output="$(host url "$PORT" --timeout 30 --private 2>&1)" || { host hide "$PORT" >/dev/null 2>&1 || true; fail 'Boat could not resolve its private HTTPS route.'; }
PUBLIC_ORIGIN="$(route_origin "$private_output")" || fail 'Boat did not return a stable HTTPS host URL.'
kill "$TEMP_PID" 2>/dev/null || true
wait "$TEMP_PID" 2>/dev/null || true
TEMP_PID=""

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agora-boat.XXXXXX")"
chmod 700 "$TEMP_DIR"
SOURCE_DIR="$TEMP_DIR/source"
git clone --filter=blob:none --no-checkout https://github.com/pkyanam/agora-payments.git "$SOURCE_DIR" >/dev/null 2>&1 || fail 'Could not fetch Agora source in the Boat sandbox.'
git -C "$SOURCE_DIR" fetch --depth=1 origin "$SOURCE_COMMIT" >/dev/null 2>&1 || fail "Could not fetch the pinned installer revision $SOURCE_COMMIT."
git -C "$SOURCE_DIR" checkout --detach FETCH_HEAD >/dev/null 2>&1 || fail 'Could not select the pinned installer revision.'
[[ "$(git -C "$SOURCE_DIR" rev-parse HEAD)" == "$SOURCE_COMMIT" ]] || fail 'Remote installer source did not match the local installer revision.'
printf 'Installing pinned Agora source %s into %s...\n' "${SOURCE_COMMIT:0:12}" "$APP_DIR"
bash "$SOURCE_DIR/install.sh" --target local --non-interactive --owner-email "$OWNER_EMAIL" --dir "$APP_DIR" --url "$PUBLIC_ORIGIN" --port "$PORT" --host 0.0.0.0 || fail 'Agora installation failed. The sandbox and its private route were left intact for recovery.'

write_service "$(id -un)"
"${SUDO[@]}" systemctl start "$SERVICE"
wait_for_health || fail "Agora did not become healthy on port $PORT; the public route remains private. Inspect `sudo journalctl -u $SERVICE`."
host_publicly
if ! install_agora_cli; then printf 'Warning: Agora is live, but the Agora CLI did not install. Retry inside the sandbox with the Agora CLI installer.\n' >&2; fi
