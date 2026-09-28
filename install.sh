#!/usr/bin/env bash
# Agora Community local installer. Re-runs preserve installation state and never reset data.
set -euo pipefail
ORIGINAL_ARGS=("$@")
for ((i = 0; i + 1 < ${#ORIGINAL_ARGS[@]}; i++)); do
  if [[ "${ORIGINAL_ARGS[$i]}" == --target && "${ORIGINAL_ARGS[$((i + 1))]}" == cloudflare ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
    exec bash "$SCRIPT_DIR/install-cloud.sh" "${ORIGINAL_ARGS[@]}"
  fi
done

TARGET=local
TARGET_SET=0
APP_DIR="${AGORA_INSTALL_DIR:-${HOME:?HOME is required}/.local/share/agora}"
ORIGIN=http://localhost:3000
OWNER_EMAIL=
PORT=3000
PORT_SET=0
HOST=127.0.0.1
NON_INTERACTIVE=0
UPDATE=0

usage() {
  cat <<'USAGE'
Agora Community installer

Usage: bash install.sh [options]
  --target local              Install the persistent Node + SQLite app (default)
  --dir ABSOLUTE_PATH         Installation directory (default: ~/.local/share/agora)
  --url ORIGIN                 Public origin (default: http://localhost:3000)
  --owner-email EMAIL          First owner login email
  --port PORT                  Local port (default: 3000)
  --host ADDRESS               Bind address (default: 127.0.0.1)
  --non-interactive            Disable prompts; requires --owner-email
  --update                     Update an existing installation
  --help                       Show this help

The source repository is private during prerelease. Run from an authenticated checkout,
or use GitHub CLI authentication. Updates use the pinned repository/ref in install.json.
USAGE
}

while (($#)); do
  case "$1" in
    --target) TARGET="${2:?Missing value for --target}"; TARGET_SET=1; shift 2 ;;
    --dir) APP_DIR="${2:?Missing value for --dir}"; shift 2 ;;
    --url) ORIGIN="${2:?Missing value for --url}"; shift 2 ;;
    --owner-email) OWNER_EMAIL="${2:?Missing value for --owner-email}"; shift 2 ;;
    --port) PORT="${2:?Missing value for --port}"; PORT_SET=1; shift 2 ;;
    --host) HOST="${2:?Missing value for --host}"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --update) UPDATE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if ((!TARGET_SET && !NON_INTERACTIVE)) && [[ -r /dev/tty ]]; then
  printf 'Install target [local/cloudflare] (local): ' > /dev/tty
  IFS= read -r TARGET_ANSWER < /dev/tty || TARGET_ANSWER=
  TARGET="${TARGET_ANSWER:-local}"
fi

if [[ "$TARGET" == cloudflare ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  exec bash "$SCRIPT_DIR/install-cloud.sh" "${ORIGINAL_ARGS[@]}"
fi
[[ "$TARGET" == local ]] || { printf 'Unsupported target: %s (currently supported: local, cloudflare)\n' "$TARGET" >&2; exit 2; }
[[ "$APP_DIR" == /* ]] || { printf '%s\n' '--dir must be an absolute path.' >&2; exit 2; }
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT > 0 && PORT < 65536)) || { printf '%s\n' '--port must be between 1 and 65535.' >&2; exit 2; }
ORIGIN="$(node --input-type=module - "$ORIGIN" <<'NODE'
const value=process.argv[2];let u;
try{u=new URL(value)}catch{throw new Error('Enter a valid deployment origin.')}
const local=u.protocol==='http:'&&(u.hostname==='localhost'||u.hostname==='127.0.0.1'||u.hostname==='[::1]');
if(u.protocol!=='https:'&&!local)throw new Error('Use public HTTPS or loopback HTTP.');
if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('Provide an origin without credentials, path, query, or fragment.');
console.log(u.origin);
NODE
)"
if [[ "$ORIGIN" == http://localhost:* || "$ORIGIN" == http://127.0.0.1:* || "$ORIGIN" == http://\[::1\]:* ]]; then
  ORIGIN_PORT="${ORIGIN##*:}"
  if ((PORT_SET)); then [[ "$PORT" == "$ORIGIN_PORT" ]] || { printf 'Loopback URL port %s must match --port %s.\n' "$ORIGIN_PORT" "$PORT" >&2; exit 2; }
  else PORT="$ORIGIN_PORT"; fi
fi
if [[ -z "$OWNER_EMAIL" && ! $NON_INTERACTIVE -eq 1 && -r /dev/tty ]]; then
  printf 'Owner email: ' > /dev/tty
  IFS= read -r OWNER_EMAIL < /dev/tty || OWNER_EMAIL=
fi
if [[ -z "$OWNER_EMAIL" ]]; then
  if ((NON_INTERACTIVE)); then printf '%s\n' '--owner-email is required with --non-interactive.' >&2; else printf '%s\n' 'Owner email is required when stdin is not a terminal.' >&2; fi
  exit 2
fi
[[ "$OWNER_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { printf '%s\n' 'Enter a valid owner email.' >&2; exit 2; }

command -v node >/dev/null 2>&1 || { printf '%s\n' 'Install Node.js 22.16 or newer, then rerun.' >&2; exit 1; }
node -e 'const [a,b,c]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&(b>16||(b===16&&c>=0)))?0:1)' || { printf 'Agora local requires Node.js 22.16+ for SQLite backup support; found %s.\n' "$(node --version)" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { printf '%s\n' 'Install npm with Node.js, then rerun.' >&2; exit 1; }
command -v git >/dev/null 2>&1 || { printf '%s\n' 'Install Git, then rerun.' >&2; exit 1; }

mkdir -p "$(dirname "$APP_DIR")"
APP_DIR="$(cd "$(dirname "$APP_DIR")" && pwd -P)/$(basename "$APP_DIR")"
[[ ! -L "$APP_DIR" ]] || { printf 'Refusing a symlink installation directory: %s\n' "$APP_DIR" >&2; exit 1; }
if [[ -f "$APP_DIR/install.json" ]]; then
  if ((UPDATE)); then exec bash "$APP_DIR/update.sh" --dir "$APP_DIR"; fi
  node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(`Agora ${m.current_version} is already installed at ${m.install_dir}. Use bash install.sh --dir "${m.install_dir}" --update to update.`)' "$APP_DIR/install.json"
  exit 0
fi
if [[ -e "$APP_DIR" && ! -d "$APP_DIR" ]]; then printf 'Refusing to replace a non-directory path: %s\n' "$APP_DIR" >&2; exit 1; fi
if [[ -d "$APP_DIR" && -z "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then :
elif [[ -d "$APP_DIR" ]]; then
  for existing in "$APP_DIR"/* "$APP_DIR"/.[!.]* "$APP_DIR"/..?*; do
    [[ -e "$existing" || -L "$existing" ]] || continue
    case "$(basename "$existing")" in repository.git|releases|state|.operation-lock) ;;
      *) printf 'Refusing to overwrite unexpected content in %s: %s\n' "$APP_DIR" "$existing" >&2; exit 1 ;;
    esac
  done
fi
for critical in "$APP_DIR/repository.git" "$APP_DIR/releases" "$APP_DIR/state" "$APP_DIR/state/data" "$APP_DIR/state/backups" "$APP_DIR/state/.env.local" "$APP_DIR/state/data/agora.sqlite"; do
  [[ ! -L "$critical" ]] || { printf 'Refusing a symlink at critical installation path: %s\n' "$critical" >&2; exit 1; }
done

SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
REPO_SOURCE=
if [[ -n "$SCRIPT_SOURCE" && -f "$SCRIPT_SOURCE" ]]; then
  CANDIDATE="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd -P)"
  if [[ -f "$CANDIDATE/package.json" && -d "$CANDIDATE/workers/ledger" && -d "$CANDIDATE/.git" ]]; then REPO_SOURCE="$CANDIDATE"; fi
fi
TEMP_SOURCE=
if [[ -z "$REPO_SOURCE" ]]; then
  command -v gh >/dev/null 2>&1 || { printf '%s\n' 'The source repo is private during prerelease. Run from its checkout or sign in with GitHub CLI (`gh auth login`).' >&2; exit 1; }
  gh auth status >/dev/null 2>&1 || { printf '%s\n' 'Sign in to GitHub with `gh auth login`, then rerun.' >&2; exit 1; }
  TEMP_SOURCE="$(mktemp -d "${TMPDIR:-/tmp}/agora-source.XXXXXX")"
  trap 'rm -rf "$TEMP_SOURCE"' EXIT INT TERM
  gh repo clone pkyanam/agora-payments "$TEMP_SOURCE/source"
  REPO_SOURCE="$TEMP_SOURCE/source"
fi

if [[ -n "$(git -C "$REPO_SOURCE" status --porcelain --untracked-files=all)" ]]; then
  printf 'The source checkout has local edits. Commit or stash them before installing from it: %s\n' "$REPO_SOURCE" >&2
  exit 1
fi

mkdir -p "$APP_DIR" "$APP_DIR/releases" "$APP_DIR/state/data" "$APP_DIR/state/backups"
chmod 700 "$APP_DIR" "$APP_DIR/state" "$APP_DIR/state/data" "$APP_DIR/state/backups"
LOCK_DIR="$APP_DIR/.operation-lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then printf 'Another Agora installer/update may be using %s.\n' "$APP_DIR" >&2; exit 1; fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true; [[ -z "${TEMP_SOURCE:-}" ]] || rm -rf "$TEMP_SOURCE"' EXIT INT TERM

REPO_CACHE="$APP_DIR/repository.git"
if [[ ! -d "$REPO_CACHE" ]]; then
  # Do not use --shared here: curl | bash clones private source into a temporary
  # directory and removes it after install. A shared bare clone would retain an
  # alternates link to that temporary object store and break later updates.
  git clone --bare "$REPO_SOURCE" "$REPO_CACHE" >/dev/null
  git --git-dir="$REPO_CACHE" remote set-url origin https://github.com/pkyanam/agora-payments.git
else
  [[ "$(git --git-dir="$REPO_CACHE" remote get-url origin)" == 'https://github.com/pkyanam/agora-payments.git' ]] || { printf '%s\n' 'Existing installation cache points to an unexpected repository.' >&2; exit 1; }
fi
COMMIT="$(git -C "$REPO_SOURCE" rev-parse HEAD)"
if ! git --git-dir="$REPO_CACHE" cat-file -e "$COMMIT^{commit}" 2>/dev/null; then
  git --git-dir="$REPO_CACHE" fetch --quiet "$REPO_SOURCE" HEAD
  COMMIT="$(git --git-dir="$REPO_CACHE" rev-parse FETCH_HEAD)"
fi
SHORT_COMMIT="${COMMIT:0:12}"
STAGE="$APP_DIR/releases/$SHORT_COMMIT"
if [[ ! -d "$STAGE" ]]; then git --git-dir="$REPO_CACHE" worktree add --detach "$STAGE" "$COMMIT" >/dev/null; fi

ENV_FILE="$APP_DIR/state/.env.local"
SECRETS_FILE="$APP_DIR/state/community-owner-credentials.txt"
if [[ ! -f "$ENV_FILE" ]]; then
  node --input-type=module - "$ENV_FILE" "$SECRETS_FILE" "$APP_DIR/state/data/agora.sqlite" "$ORIGIN" "$OWNER_EMAIL" "$SHORT_COMMIT" <<'NODE'
import { randomBytes } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
const [envPath, secretsPath, dbPath, origin, email, version] = process.argv.slice(2);
const password = randomBytes(24).toString('base64url');
const adminToken = randomBytes(32).toString('base64url');
const encryptionKey = randomBytes(32).toString('base64');
const q = (s) => JSON.stringify(s);
const rows = [
  'NODE_ENV=production', 'AGORA_DEPLOYMENT_TYPE=community', 'AGORA_DEPLOYMENT_TARGET=node', 'AGORA_DEPLOYMENT_ENV=community',
  'AGORA_PAYMENT_PROVIDER=stripe', 'AGORA_STRIPE_MODE=test', `AGORA_VERSION=${q(version)}`,
  `AGORA_PUBLIC_ORIGIN=${q(origin)}`, `AGORA_OWNER_EMAIL=${q(email)}`, `AGORA_ADMIN_PASSWORD=${q(password)}`,
  `AGORA_ADMIN_TOKEN=${q(adminToken)}`, `AGORA_MFA_ENCRYPTION_KEY=${q(encryptionKey)}`,
  `AGORA_SECRETS_ENCRYPTION_KEY=${q(encryptionKey)}`, `AGORA_DATABASE_PATH=${q(dbPath)}`,
  'AGORA_SEED=false',
].join('\n') + '\n';
await writeFile(envPath, rows, { mode: 0o600, flag: 'wx' });
await chmod(envPath, 0o600);
await writeFile(secretsPath, `Agora Community owner bootstrap\nEmail: ${email}\nPassword: ${password}\n\nKeep this file private. Change the password after sign-in, then remove this file.\n`, { mode: 0o600, flag: 'wx' });
await chmod(secretsPath, 0o600);
NODE
else
  chmod 600 "$ENV_FILE"
  printf 'Preserved existing configuration at %s\n' "$ENV_FILE"
fi
node --input-type=module - "$ENV_FILE" "$SHORT_COMMIT" <<'NODE'
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
const file=process.argv[2],version=process.argv[3],current=await readFile(file,'utf8');
const rows=current.split(/\r?\n/).filter(row=>!/^AGORA_VERSION=/.test(row));rows.push(`AGORA_VERSION=${JSON.stringify(version)}`);
const temp=`${file}.${process.pid}.tmp`;await writeFile(temp,rows.join('\n'),{mode:0o600,flag:'wx'});await rename(temp,file);await chmod(file,0o600);
NODE

if [[ -f "$APP_DIR/install.json" ]]; then printf '%s\n' 'Unexpected install manifest appeared during installation; stopping safely.' >&2; exit 1; fi
if [[ -f "$STAGE/.env.local" && ! -L "$STAGE/.env.local" ]] && grep -Fq "AGORA_DATABASE_PATH=\"$STAGE/.data/build.sqlite\"" "$STAGE/.env.local"; then rm "$STAGE/.env.local"; fi
if [[ -L "$STAGE/.env.local" && "$(readlink "$STAGE/.env.local")" == "$ENV_FILE" ]]; then rm "$STAGE/.env.local"; fi
if [[ -L "$STAGE/.data" && "$(readlink "$STAGE/.data")" == "$APP_DIR/state/data" ]]; then rm "$STAGE/.data"; fi
if [[ -d "$STAGE/.data" && ! -L "$STAGE/.data" ]]; then
  for file in "$STAGE"/.data/*; do
    [[ -e "$file" ]] || continue
    [[ "$(basename "$file")" =~ ^build\.sqlite(-wal|-shm|-journal)?$ && -f "$file" && ! -L "$file" ]] || { printf 'Refusing to remove unexpected staged data: %s\n' "$file" >&2; exit 1; }
    rm "$file"
  done
  rmdir "$STAGE/.data"
fi
[[ ! -e "$STAGE/.env.local" && ! -e "$STAGE/.data" ]] || { printf 'Refusing to replace staged files in %s\n' "$STAGE" >&2; exit 1; }
node --input-type=module - "$ENV_FILE" "$STAGE/.env.local" "$STAGE/.data/build.sqlite" <<'NODE'
import { chmod, readFile, writeFile } from 'node:fs/promises';
const [source,target,db]=process.argv.slice(2);let rows=(await readFile(source,'utf8')).split(/\r?\n/).filter(x=>x&&!/^AGORA_DATABASE_PATH=|^AGORA_SEED=/.test(x));rows.push(`AGORA_DATABASE_PATH=${JSON.stringify(db)}`,'AGORA_SEED=false');await writeFile(target,rows.join('\n')+'\n',{mode:0o600,flag:'wx'});await chmod(target,0o600);
NODE
mkdir "$STAGE/.data"
cd "$STAGE"
npm install --no-audit --no-fund --no-package-lock
if ! npm run build; then
  rm -f "$STAGE/.env.local"; rm -rf "$STAGE/.data"; ln -s ../../state/.env.local "$STAGE/.env.local"; ln -s ../../state/data "$STAGE/.data"
  exit 1
fi
rm "$STAGE/.env.local"
rm -rf "$STAGE/.data"
ln -s ../../state/.env.local "$STAGE/.env.local"
ln -s ../../state/data "$STAGE/.data"

node --input-type=module - "$APP_DIR/install.json" "$APP_DIR" "$COMMIT" "$SHORT_COMMIT" "$PORT" "$HOST" "$ORIGIN" "$OWNER_EMAIL" <<'NODE'
import { chmod, rename, writeFile } from 'node:fs/promises';
const [manifest, root, commit, version, port, host, origin, email] = process.argv.slice(2);
const temp = `${manifest}.${process.pid}.tmp`;
await writeFile(temp, `${JSON.stringify({ format: 1, install_dir: root, deployment_target: 'node', repository: 'pkyanam/agora-payments', git_ref: 'main', current_version: version, commit, port: Number(port), host, public_origin: origin, owner_email: email, updated_at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
await rename(temp, manifest); await chmod(manifest, 0o600);
NODE
ln -s "releases/$SHORT_COMMIT" "$APP_DIR/.current.new"
mv "$APP_DIR/.current.new" "$APP_DIR/current"
cp "$STAGE/update.sh" "$APP_DIR/update.sh"
cp "$STAGE/start.sh" "$APP_DIR/start.sh"
chmod 700 "$APP_DIR/update.sh" "$APP_DIR/start.sh"

cat <<RESULT

Agora Community is installed at: $APP_DIR
Release: $SHORT_COMMIT
SQLite data and private configuration stay in this installation across upgrades.
Owner bootstrap credentials are in: $SECRETS_FILE
Payments start in Stripe test mode. Configure test credentials and verify a signed test webhook before issuing API keys.
Start the app with: "$APP_DIR/start.sh"
Open: $ORIGIN
Check status with: agora server status --dir "$APP_DIR"
Update with: agora server update --dir "$APP_DIR"
RESULT
