#!/usr/bin/env bash
# Host-side updater for a local install created by install.sh. It only trusts the pinned repo/ref manifest.
set -euo pipefail
APP_DIR=
while (($#)); do
  case "$1" in
    --dir) APP_DIR="${2:?Missing --dir value}"; shift 2 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
[[ "$APP_DIR" == /* ]] || { printf '%s\n' 'Pass an absolute --dir path.' >&2; exit 2; }
APP_DIR="$(cd "$APP_DIR" && pwd -P)"
MANIFEST="$APP_DIR/install.json"
[[ ! -L "$APP_DIR/install.json" && ! -L "$APP_DIR/repository.git" && ! -L "$APP_DIR/releases" && ! -L "$APP_DIR/state" && ! -L "$APP_DIR/state/backups" && ! -L "$APP_DIR/state/.env.local" && ! -L "$APP_DIR/state/data" && ! -L "$APP_DIR/state/data/agora.sqlite" && ! -L "$APP_DIR/state/server.pid" ]] || { printf '%s\n' 'Refusing a symlink in a critical Agora installation path.' >&2; exit 1; }
[[ -f "$MANIFEST" ]] || { printf 'No Agora installation manifest at %s\n' "$MANIFEST" >&2; exit 1; }
node --input-type=module - "$MANIFEST" <<'NODE'
import { readFile } from 'node:fs/promises';
const m=JSON.parse(await readFile(process.argv[2],'utf8'));
if(m.format!==1||m.deployment_target!=='node'||m.repository!=='pkyanam/agora-payments'||m.git_ref!=='main')throw new Error('Unsupported or modified Agora install manifest.');
NODE
PORT="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).port' "$MANIFEST")"
HOST="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).host' "$MANIFEST")"
[[ "$PORT" =~ ^[0-9]+$ && "$PORT" -gt 0 && "$PORT" -lt 65536 && "$HOST" =~ ^[A-Za-z0-9.:-]+$ ]] || { printf '%s\n' 'Install manifest has an invalid bind address or port.' >&2; exit 1; }
REPO_CACHE="$APP_DIR/repository.git"
[[ -d "$REPO_CACHE" ]] || { printf '%s\n' 'The installation Git cache is missing. Refusing to guess a source.' >&2; exit 1; }
[[ "$(git --git-dir="$REPO_CACHE" config --get remote.origin.url)" == 'https://github.com/pkyanam/agora-payments.git' ]] || { printf '%s\n' 'The configured update source does not match the official Agora repository.' >&2; exit 1; }
LOCK_DIR="$APP_DIR/.operation-lock"
mkdir "$LOCK_DIR" 2>/dev/null || { printf '%s\n' 'Another Agora update is already running.' >&2; exit 1; }
RECOVERY_ACTIVE=0
BACKUP_READY=0
WAS_RUNNING=0
OLD_PID=
NEW_PID=
BACKUP=
recover_update() {
  local result="$1" restored=0 probe_host
  trap - EXIT INT TERM
  set +e
  if ((RECOVERY_ACTIVE)); then
    if [[ -n "$NEW_PID" && "$NEW_PID" != "$OLD_PID" ]] && kill -0 "$NEW_PID" 2>/dev/null; then
      local new_cwd new_cmd new_uid
      new_cwd="$(lsof -a -p "$NEW_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
      new_cmd="$(ps -p "$NEW_PID" -o command= 2>/dev/null || true)"
      new_uid="$(ps -p "$NEW_PID" -o uid= 2>/dev/null | tr -d ' ')"
      if [[ "$new_uid" == "$(id -u)" && "$new_cwd" == "${NEW_DIR:-}" && "$new_cmd" == *"next-server (v"* ]]; then
        kill -TERM "$NEW_PID" 2>/dev/null || true
        for _ in {1..15}; do kill -0 "$NEW_PID" 2>/dev/null || break; sleep 1; done
      fi
    fi
    if [[ -n "${OLD_REL:-}" && -n "${CURRENT:-}" ]]; then
      local recovery_link="$APP_DIR/.current.recovery.$$"
      if [[ ! -e "$recovery_link" && ! -L "$recovery_link" ]]; then ln -s "$OLD_REL" "$recovery_link" && node -e 'require("fs").renameSync(process.argv[1],process.argv[2])' "$recovery_link" "$CURRENT"; fi
    fi
    if ((BACKUP_READY)) && [[ -f "$BACKUP" && ! -L "$BACKUP" ]]; then
      cp "$BACKUP" "$APP_DIR/state/data/agora.restore.sqlite" && rm -f "$APP_DIR/state/data/agora.sqlite-wal" "$APP_DIR/state/data/agora.sqlite-shm" && mv -f "$APP_DIR/state/data/agora.restore.sqlite" "$APP_DIR/state/data/agora.sqlite"
    fi
    if [[ -f "$APP_DIR/state/.env-version-backup-${VERSION:-}" && ! -L "$APP_DIR/state/.env-version-backup-${VERSION:-}" ]]; then
      cp "$APP_DIR/state/.env-version-backup-$VERSION" "$APP_DIR/state/.env.local" && chmod 600 "$APP_DIR/state/.env.local"
    fi
    if [[ -n "${MANIFEST:-}" && -f "$MANIFEST" && -n "${OLD_COMMIT:-}" ]]; then
      node --input-type=module - "$MANIFEST" "$OLD_COMMIT" "$OLD_VERSION" <<'NODE'
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
const [file,commit,version]=process.argv.slice(2);const m=JSON.parse(await readFile(file,'utf8'));m.commit=commit;m.current_version=version;const temp=`${file}.${process.pid}.recovery`;await writeFile(temp,`${JSON.stringify(m,null,2)}\n`,{mode:0o600,flag:'wx'});await rename(temp,file);await chmod(file,0o600);
NODE
    fi
    if [[ -n "${OLD_DIR:-}" && -f "$OLD_DIR/start.sh" && -f "$OLD_DIR/update.sh" ]]; then
      cp "$OLD_DIR/start.sh" "$APP_DIR/start.sh" && cp "$OLD_DIR/update.sh" "$APP_DIR/update.sh" && chmod 700 "$APP_DIR/start.sh" "$APP_DIR/update.sh"
    fi
    if ((WAS_RUNNING)); then
      probe_host="$HOST"; [[ "$probe_host" == 0.0.0.0 || "$probe_host" == :: ]] && probe_host=127.0.0.1
      [[ "$probe_host" == *:* ]] && probe_host="[$probe_host]"
      if ! node -e 'fetch(`http://${process.argv[1]}:${process.argv[2]}/api/health`).then(async r=>{const j=await r.json();process.exit(r.ok&&j.deployment_target==="node"&&j.current_version===process.argv[3]?0:1)}).catch(()=>process.exit(1))' "$probe_host" "$PORT" "$OLD_VERSION"; then
        nohup "$APP_DIR/start.sh" >> "$APP_DIR/state/server.log" 2>&1 < /dev/null &
        local recovery_pid=$!; restored=0
        for _ in {1..30}; do
          if node -e 'fetch(`http://${process.argv[1]}:${process.argv[2]}/api/health`).then(async r=>{const j=await r.json();process.exit(r.ok&&j.deployment_target==="node"&&j.current_version===process.argv[3]?0:1)}).catch(()=>process.exit(1))' "$probe_host" "$PORT" "$OLD_VERSION"; then restored=1; break; fi
          if ! kill -0 "$recovery_pid" 2>/dev/null; then break; fi
          sleep 1
        done
      else restored=1; fi
      if ((restored==0)); then printf 'Update recovery restored release/data but could not confirm service health. Run %s/start.sh and inspect %s/state/server.log.\n' "$APP_DIR" "$APP_DIR" >&2; fi
    fi
    rm -f "$APP_DIR/state/.env-version-backup-${VERSION:-}"
  fi
  rmdir "$LOCK_DIR" 2>/dev/null || true
  exit "$result"
}
trap 'recover_update $?' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

CURRENT="$APP_DIR/current"
[[ -L "$CURRENT" ]] || { printf '%s\n' 'The current release link is missing; refusing to update.' >&2; exit 1; }
OLD_REL="$(readlink "$CURRENT")"
[[ "$OLD_REL" =~ ^releases/[0-9a-f]{12}$ ]] || { printf '%s\n' 'The active release link is outside the managed releases directory.' >&2; exit 1; }
OLD_DIR="$(cd "$APP_DIR/$OLD_REL" && pwd -P)"
[[ "$OLD_DIR" == "$APP_DIR"/releases/* ]] || { printf '%s\n' 'The resolved active release leaves this installation.' >&2; exit 1; }
OLD_COMMIT="$(git -C "$OLD_DIR" rev-parse HEAD)"
OLD_VERSION="${OLD_COMMIT:0:12}"
[[ "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).current_version' "$MANIFEST")" == "$OLD_VERSION" ]] || { printf '%s\n' 'Manifest version does not match the active release.' >&2; exit 1; }
[[ -d "$OLD_DIR/.git" || -f "$OLD_DIR/.git" ]] || { printf '%s\n' 'The active release is not a managed Git worktree.' >&2; exit 1; }
[[ -L "$OLD_DIR/.data" ]] || { printf '%s\n' 'Expected managed data symlink is missing.' >&2; exit 1; }
OLD_DATA_LINK="$(readlink "$OLD_DIR/.data")"
[[ "$OLD_DATA_LINK" == ../../state/data || "$OLD_DATA_LINK" == "$APP_DIR/state/data" ]] || { printf '%s\n' 'The data symlink does not resolve to the managed data directory.' >&2; exit 1; }
if [[ -n "$(git -C "$OLD_DIR" status --porcelain --untracked-files=all -- . ':(exclude).data')" ]]; then
  printf 'Local edits were found in the active release. Save or revert them before updating: %s\n' "$OLD_DIR" >&2
  exit 1
fi

git --git-dir="$REPO_CACHE" fetch --quiet --depth=1 origin refs/heads/main
COMMIT="$(git --git-dir="$REPO_CACHE" rev-parse FETCH_HEAD)"
VERSION="${COMMIT:0:12}"
if [[ "$VERSION" == "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).current_version' "$MANIFEST")" ]]; then
  printf 'Agora is already current (%s).\n' "$VERSION"
  exit 0
fi
NEW_DIR="$APP_DIR/releases/$VERSION"
if [[ ! -d "$NEW_DIR" ]]; then
  git --git-dir="$REPO_CACHE" worktree add --detach "$NEW_DIR" "$COMMIT"
fi
if [[ -n "$(git -C "$NEW_DIR" status --porcelain --untracked-files=all -- . ':(exclude).data')" ]]; then
  printf 'The staged release has local edits. Refusing to replace it: %s\n' "$NEW_DIR" >&2
  exit 1
fi

if [[ -f "$NEW_DIR/.env.local" && ! -L "$NEW_DIR/.env.local" ]] && grep -Fq "AGORA_DATABASE_PATH=\"$NEW_DIR/.data/build.sqlite\"" "$NEW_DIR/.env.local"; then rm "$NEW_DIR/.env.local"; fi
if [[ -L "$NEW_DIR/.env.local" ]]; then
  ENV_LINK="$(readlink "$NEW_DIR/.env.local")"
  if [[ "$ENV_LINK" == "$APP_DIR/state/.env.local" || "$ENV_LINK" == ../../state/.env.local ]]; then rm "$NEW_DIR/.env.local"; fi
fi
if [[ -L "$NEW_DIR/.data" ]]; then
  DATA_LINK="$(readlink "$NEW_DIR/.data")"
  if [[ "$DATA_LINK" == "$APP_DIR/state/data" || "$DATA_LINK" == ../../state/data ]]; then rm "$NEW_DIR/.data"; fi
fi
if [[ -d "$NEW_DIR/.data" && ! -L "$NEW_DIR/.data" ]]; then
  for file in "$NEW_DIR"/.data/*; do
    [[ -e "$file" ]] || continue
    [[ "$(basename "$file")" =~ ^build\.sqlite(-wal|-shm|-journal)?$ && -f "$file" && ! -L "$file" ]] || { printf 'Refusing to remove unexpected staged data: %s\n' "$file" >&2; exit 1; }
    rm "$file"
  done
  rmdir "$NEW_DIR/.data"
fi
[[ ! -e "$NEW_DIR/.env.local" && ! -e "$NEW_DIR/.data" ]] || { printf 'Refusing to replace unexpected staged configuration in %s\n' "$NEW_DIR" >&2; exit 1; }
node --input-type=module - "$APP_DIR/state/.env.local" "$NEW_DIR/.env.local" "$NEW_DIR/.data/build.sqlite" <<'NODE'
import { chmod, readFile, writeFile } from 'node:fs/promises';
const [source,target,db]=process.argv.slice(2);let rows=(await readFile(source,'utf8')).split(/\r?\n/).filter(x=>x&&!/^AGORA_DATABASE_PATH=|^AGORA_SEED=/.test(x));rows.push(`AGORA_DATABASE_PATH=${JSON.stringify(db)}`,'AGORA_SEED=false');await writeFile(target,rows.join('\n')+'\n',{mode:0o600,flag:'wx'});await chmod(target,0o600);
NODE
mkdir "$NEW_DIR/.data"
cd "$NEW_DIR"
npm install --no-audit --no-fund --no-package-lock
if ! npm run build; then
  rm -f "$NEW_DIR/.env.local"; rm -rf "$NEW_DIR/.data"; ln -s ../../state/.env.local "$NEW_DIR/.env.local"; ln -s ../../state/data "$NEW_DIR/.data"
  exit 1
fi
rm "$NEW_DIR/.env.local"
rm -rf "$NEW_DIR/.data"
ln -s ../../state/.env.local "$NEW_DIR/.env.local"
ln -s ../../state/data "$NEW_DIR/.data"

BACKUP="$APP_DIR/state/backups/agora-before-$VERSION-$(date +%Y%m%d%H%M%S).sqlite"
PID_FILE="$APP_DIR/state/server.pid"
if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pid' "$PID_FILE" 2>/dev/null || true)"
  RECORDED_START="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).start_time' "$PID_FILE" 2>/dev/null || true)"
  RECORDED_UID="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).uid' "$PID_FILE" 2>/dev/null || true)"
  if [[ "${OLD_PID:-}" =~ ^[0-9]+$ ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    ACTUAL_START="$(ps -p "$OLD_PID" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//')"
    ACTUAL_UID="$(ps -p "$OLD_PID" -o uid= 2>/dev/null | tr -d ' ')"
    ACTUAL_COMMAND="$(ps -p "$OLD_PID" -o command= 2>/dev/null || true)"
    RECORDED_CWD="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).workdir' "$PID_FILE" 2>/dev/null || true)"
    if [[ -d "/proc/$OLD_PID" ]]; then ACTUAL_CWD="$(readlink -f "/proc/$OLD_PID/cwd" 2>/dev/null || true)"
    elif command -v lsof >/dev/null 2>&1; then ACTUAL_CWD="$(lsof -a -p "$OLD_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    else ACTUAL_CWD=; fi
    [[ "$ACTUAL_START" == "$RECORDED_START" && "$ACTUAL_UID" == "$RECORDED_UID" && "$ACTUAL_UID" == "$(id -u)" && "$ACTUAL_CWD" == "$RECORDED_CWD" && "$ACTUAL_CWD" == "$OLD_DIR" && ( "$ACTUAL_COMMAND" == *"$APP_DIR/current/node_modules/next/dist/bin/next start"* || "$ACTUAL_COMMAND" == *"next-server (v"* || "$ACTUAL_COMMAND" == *"/next-server"* ) ]] || { printf 'PID identity does not match this Agora installation. Inspect %s before updating.\n' "$PID_FILE" >&2; exit 1; }
    WAS_RUNNING=1
    RECOVERY_ACTIVE=1
    kill -TERM "$OLD_PID"
    for _ in {1..30}; do kill -0 "$OLD_PID" 2>/dev/null || break; sleep 1; done
    if kill -0 "$OLD_PID" 2>/dev/null; then printf '%s\n' 'Agora did not stop within 30 seconds; the current release remains active.' >&2; exit 1; fi
  else
    rm -f "$PID_FILE"
  fi
fi

if [[ -f "$APP_DIR/state/data/agora.sqlite" ]]; then
  umask 077
  if ! node --input-type=module - "$APP_DIR/state/data/agora.sqlite" "$BACKUP" <<'NODE'
import { chmod } from 'node:fs/promises';
import { DatabaseSync, backup } from 'node:sqlite';
const source=new DatabaseSync(process.argv[2]);
try { await backup(source,process.argv[3]); } finally { source.close(); }
await chmod(process.argv[3],0o600);
NODE
  then
    printf '%s\n' 'SQLite backup failed. The old release is still selected; update stopped.' >&2
    exit 1
  fi
  BACKUP_READY=1
  printf 'Database backup saved at %s\n' "$BACKUP"
fi
RECOVERY_ACTIVE=1

cp "$APP_DIR/state/.env.local" "$APP_DIR/state/.env-version-backup-$VERSION"
node --input-type=module - "$APP_DIR/state/.env.local" "$VERSION" <<'NODE'
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
const file=process.argv[2], version=process.argv[3], current=await readFile(file,'utf8');
const rows=current.split(/\r?\n/).filter(row=>!/^AGORA_VERSION=/.test(row));rows.push(`AGORA_VERSION=${JSON.stringify(version)}`);
const temp=`${file}.${process.pid}.tmp`;await writeFile(temp,rows.join('\n'),{mode:0o600,flag:'wx'});await rename(temp,file);await chmod(file,0o600);
NODE

ln -s "releases/$VERSION" "$APP_DIR/.current.next"
node -e 'require("fs").renameSync(process.argv[1],process.argv[2])' "$APP_DIR/.current.next" "$CURRENT"
node --input-type=module - "$MANIFEST" "$COMMIT" "$VERSION" <<'NODE'
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
const file=process.argv[2], m=JSON.parse(await readFile(file,'utf8'));
m.commit=process.argv[3];m.current_version=process.argv[4];m.updated_at=new Date().toISOString();
const temp=`${file}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(m,null,2)}\n`,{mode:0o600,flag:'wx'});await rename(temp,file);await chmod(file,0o600);
NODE
cp "$NEW_DIR/update.sh" "$APP_DIR/update.sh"
cp "$NEW_DIR/start.sh" "$APP_DIR/start.sh"
chmod 700 "$APP_DIR/update.sh" "$APP_DIR/start.sh"

if ((WAS_RUNNING)); then
  nohup "$APP_DIR/start.sh" >> "$APP_DIR/state/server.log" 2>&1 < /dev/null &
  NEW_PID=$!
  READY=0
  for _ in {1..30}; do
    if node --input-type=module - "$APP_DIR" "$VERSION" "$HOST" "$PORT" <<'NODE'
import { readFile } from 'node:fs/promises';
const m=JSON.parse(await readFile(`${process.argv[2]}/install.json`,'utf8'));
let host=['0.0.0.0','::'].includes(process.argv[4])?'127.0.0.1':process.argv[4];if(host.includes(':'))host=`[${host}]`;
try { const r=await fetch(`http://${host}:${process.argv[5]}/api/health`,{signal:AbortSignal.timeout(700)});if(!r.ok)process.exit(1);const j=await r.json();process.exit(j.deployment_target==='node'&&j.current_version===process.argv[3]?0:1); } catch { process.exit(1); }
NODE
    then READY=1; break; fi
    if ! kill -0 "$NEW_PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if ((READY==0)); then
    printf 'New release did not become healthy; restoring the previous release and database backup %s.\n' "$BACKUP" >&2
    exit 1
  fi
fi

RECOVERY_ACTIVE=0
rm -f "$APP_DIR/state/.env-version-backup-$VERSION"

printf 'Agora updated to %s. Previous release retained at %s; backup: %s\n' "$VERSION" "$OLD_DIR" "${BACKUP:-none}"
