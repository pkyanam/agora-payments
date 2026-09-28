#!/usr/bin/env bash
# Deploy Agora's single-workspace API to a Cloudflare Worker + SQLite Durable Object.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
WORKER_NAME=""
UI_PROJECT=""
OWNER_EMAIL=""
PUBLIC_ORIGIN=""
WORKER_URL=""
APP_VERSION=""
STATE_DIR=""
NON_INTERACTIVE=0
UPDATE=0

usage() {
  cat <<'USAGE'
Agora Community Cloudflare API installer

Usage: bash install.sh --target cloudflare [options]
  --worker-name NAME       Worker name (default: agora-community-<random>)
  --owner-email EMAIL      First owner login email
  --url HTTPS_ORIGIN       Optional existing Vercel alias; otherwise inspected from the new deployment
  --ui-project NAME        Separate Vercel project (default: <worker-name>-ui)
  --state-dir ABS_PATH     Private local state directory (default: ~/.config/agora/cloudflare/<worker>)
  --non-interactive        Disable prompts; requires all values above
  --update                 Redeploy an existing installation without rotating secrets
  --help                   Show this help

This creates a separate Vercel UI project and Cloudflare API Worker. It does not
alter the experimental Vercel project. Stripe starts in TEST mode; no charges
are created. Vercel and Cloudflare credentials are never placed in the UI build.
USAGE
}

while (($#)); do
  case "$1" in
    --target) [[ "${2:-}" == cloudflare ]] || { echo 'install-cloud.sh only accepts --target cloudflare.' >&2; exit 2; }; shift 2 ;;
    --worker-name) WORKER_NAME="${2:?Missing value for --worker-name}"; shift 2 ;;
    --ui-project) UI_PROJECT="${2:?Missing value for --ui-project}"; shift 2 ;;
    --owner-email) OWNER_EMAIL="${2:?Missing value for --owner-email}"; shift 2 ;;
    --url) PUBLIC_ORIGIN="${2:?Missing value for --url}"; shift 2 ;;
    --state-dir) STATE_DIR="${2:?Missing value for --state-dir}"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --update) UPDATE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$WORKER_NAME" ]]; then
  if ((NON_INTERACTIVE)); then echo '--worker-name is required with --non-interactive.' >&2; exit 2; fi
  suffix="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(3).toString("hex"))')"
  WORKER_NAME="agora-community-$suffix"
  read -r -p "Cloudflare Worker name [$WORKER_NAME]: " answer
  WORKER_NAME="${answer:-$WORKER_NAME}"
fi
[[ "$WORKER_NAME" =~ ^[a-z0-9][a-z0-9-]{1,55}$ ]] || { echo 'Worker name must be 2–56 lowercase letters, digits, or hyphens.' >&2; exit 2; }

if [[ -z "$OWNER_EMAIL" && ! $NON_INTERACTIVE -eq 1 && -t 0 ]]; then read -r -p 'Owner email: ' OWNER_EMAIL; fi
[[ "$OWNER_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { echo 'Provide a valid --owner-email.' >&2; exit 2; }

if [[ -z "$PUBLIC_ORIGIN" && ! $NON_INTERACTIVE -eq 1 && -t 0 ]]; then read -r -p 'Public UI origin (HTTPS): ' PUBLIC_ORIGIN; fi
if [[ -n "$PUBLIC_ORIGIN" ]]; then PUBLIC_ORIGIN="$(node --input-type=module - "$PUBLIC_ORIGIN" <<'NODE'
const raw=process.argv[2];let u;try{u=new URL(raw)}catch{throw new Error('Provide the HTTPS origin of the browser UI.')}
if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('Use an HTTPS origin without credentials, path, query, or fragment.');
console.log(u.origin);
NODE
)"; fi
if [[ -z "$STATE_DIR" ]]; then STATE_DIR="${XDG_CONFIG_HOME:-${HOME:?HOME is required}/.config}/agora/cloudflare/$WORKER_NAME"; fi
[[ "$STATE_DIR" == /* ]] || { echo '--state-dir must be an absolute path.' >&2; exit 2; }
command -v node >/dev/null || { echo 'Install Node.js 22 or newer.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'Install npm with Node.js.' >&2; exit 1; }
command -v npx >/dev/null || { echo 'Install npm/npx with Node.js.' >&2; exit 1; }
[[ -f "$ROOT/workers/ledger/index.ts" && -f "$ROOT/wrangler.jsonc" ]] || { echo 'Run this from an Agora checkout containing workers/ledger and wrangler.jsonc.' >&2; exit 1; }
if [[ ! -d "$ROOT/node_modules/zod" ]]; then
  echo 'Installing the app dependencies needed to bundle the Worker…'
  if command -v bun >/dev/null 2>&1; then
    bun install --frozen-lockfile
  else
    # The app ships a Bun lockfile; for Node-only hosts use npm's package.json
    # ranges without writing an npm lockfile into the source checkout.
    npm install --no-audit --no-fund --no-package-lock
  fi
fi
npx --no-install wrangler whoami >/dev/null 2>&1 || { echo 'Cloudflare Wrangler is not authenticated. Run `npx wrangler login`, then retry.' >&2; exit 1; }
command -v vercel >/dev/null || { echo 'Install Vercel CLI to deploy the separate community UI (`npm install -g vercel`).' >&2; exit 1; }
vercel whoami >/dev/null 2>&1 || { echo 'Vercel CLI is not authenticated. Run `vercel login`, then retry.' >&2; exit 1; }

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
MANIFEST="$STATE_DIR/install.json"
SECRETS="$STATE_DIR/secrets.json"
CREDENTIALS="$STATE_DIR/owner-bootstrap.txt"
PENDING="$STATE_DIR/install-pending.json"
if [[ -f "$MANIFEST" ]]; then
  [[ -f "$SECRETS" && -f "$CREDENTIALS" ]] || { echo 'Existing Cloudflare install is missing private state; refusing to rotate or recreate credentials.' >&2; exit 1; }
  saved="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(m.worker_name||"")' "$MANIFEST")"
  [[ "$saved" == "$WORKER_NAME" ]] || { echo 'State directory belongs to a different Worker name.' >&2; exit 1; }
  if [[ -n "$OWNER_EMAIL" ]]; then
    saved_email="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(m.owner_email||"")' "$MANIFEST")"
    [[ "$saved_email" == "$OWNER_EMAIL" ]] || { echo 'Owner email differs from existing installation; refusing implicit credential changes.' >&2; exit 1; }
  fi
  SAVED_ORIGIN="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(m.public_origin||"")' "$MANIFEST")"
  SAVED_UI_PROJECT="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(m.ui_project||"")' "$MANIFEST")"
  [[ -z "$PUBLIC_ORIGIN" || "$PUBLIC_ORIGIN" == "$SAVED_ORIGIN" ]] || { echo 'The configured public origin cannot change during an update; use the saved alias or create a new installation.' >&2; exit 1; }
  [[ -z "$UI_PROJECT" || "$UI_PROJECT" == "$SAVED_UI_PROJECT" ]] || { echo 'The Vercel UI project cannot change during an update; use the saved project or create a new installation.' >&2; exit 1; }
  PUBLIC_ORIGIN="$SAVED_ORIGIN"
  UI_PROJECT="$SAVED_UI_PROJECT"
  WORKER_URL="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(m.worker_url||"")' "$MANIFEST")"
  [[ -n "$WORKER_URL" && -n "$UI_PROJECT" ]] || { echo 'Existing community install lacks paired Vercel/Worker metadata; refusing an unsafe update.' >&2; exit 1; }
  if ((!UPDATE)); then echo "Agora Cloudflare API is already installed. Use --update to deploy code without rotating secrets. State: $STATE_DIR"; exit 0; fi
else
  ((UPDATE)) && { echo 'No existing Cloudflare install state was found; refusing --update.' >&2; exit 1; }
  if ((NON_INTERACTIVE)); then [[ -n "$OWNER_EMAIL" ]] || { echo '--owner-email is required with --non-interactive.' >&2; exit 2; }; fi
  if [[ -f "$PENDING" ]]; then
    [[ -f "$SECRETS" && -f "$CREDENTIALS" ]] || { echo 'Incomplete private bootstrap state; refusing to rotate credentials.' >&2; exit 1; }
    PENDING_ORIGIN="$(node --input-type=module - "$PENDING" "$WORKER_NAME" "$OWNER_EMAIL" "$PUBLIC_ORIGIN" <<'NODE'
import { readFile } from 'node:fs/promises';
const [path,name,email,origin]=process.argv.slice(2);const p=JSON.parse(await readFile(path,'utf8'));
if(p.worker_name!==name||p.owner_email!==email||(origin&&p.public_origin&&p.public_origin!==origin))throw new Error('Pending install inputs differ; use the original worker name, owner email, and UI origin.');
if(!origin&&p.public_origin)process.stdout.write(p.public_origin);
NODE
    )"
    [[ -z "$PENDING_ORIGIN" ]] || PUBLIC_ORIGIN="$PENDING_ORIGIN"
  else
    [[ ! -e "$SECRETS" && ! -e "$CREDENTIALS" ]] || { echo 'Private bootstrap files exist without a matching install manifest; refusing to overwrite them.' >&2; exit 1; }
    node --input-type=module - "$SECRETS" "$CREDENTIALS" "$PENDING" "$WORKER_NAME" "$PUBLIC_ORIGIN" "$OWNER_EMAIL" <<'NODE'
import { randomBytes } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
const [secretsPath, credentialsPath, pendingPath, name, origin, email]=process.argv.slice(2);
const password=randomBytes(24).toString('base64url');
const token=randomBytes(32).toString('base64url');
const encryption=randomBytes(32).toString('base64');
const secrets={AGORA_ADMIN_PASSWORD:password,AGORA_ADMIN_TOKEN:token,AGORA_MFA_ENCRYPTION_KEY:encryption,AGORA_SECRETS_ENCRYPTION_KEY:encryption};
await writeFile(secretsPath,JSON.stringify(secrets)+'\n',{mode:0o600,flag:'wx'});await chmod(secretsPath,0o600);
await writeFile(credentialsPath,`Agora Community owner bootstrap\nEmail: ${email}\nPassword: ${password}\n\nKeep private. Sign in, enroll MFA, then rotate the owner password and remove this file.\n`,{mode:0o600,flag:'wx'});await chmod(credentialsPath,0o600);
await writeFile(pendingPath,JSON.stringify({worker_name:name,owner_email:email,public_origin:origin})+'\n',{mode:0o600,flag:'wx'});await chmod(pendingPath,0o600);
NODE
  fi
  [[ -n "$UI_PROJECT" ]] || UI_PROJECT="${WORKER_NAME}-ui"
  [[ "$UI_PROJECT" =~ ^[a-z0-9][a-z0-9-]{1,55}$ ]] || { echo 'Vercel project name must be 2–56 lowercase letters, digits, or hyphens.' >&2; exit 2; }
  if [[ -z "$PUBLIC_ORIGIN" ]]; then PUBLIC_ORIGIN="https://${UI_PROJECT}.vercel.app"; fi
fi
chmod 600 "$SECRETS" "$CREDENTIALS"

if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=all)" ]]; then
  echo 'Cloud deploy requires a clean source checkout so the separate Vercel UI receives exactly the committed files.' >&2
  exit 1
fi

CONFIG="$ROOT/.wrangler-community-$RANDOM-$$.jsonc"
CONFIG_TEMP="$CONFIG.tmp"
APP_VERSION="$(git -C "$ROOT" rev-parse --short=12 HEAD)"
DEPLOY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agora-community-ui.XXXXXX")"
chmod 700 "$DEPLOY_DIR"
cleanup_cloud() { rm -f "$CONFIG" "$CONFIG_TEMP"; [[ -z "${DEPLOY_DIR:-}" ]] || rm -rf "$DEPLOY_DIR"; }
trap cleanup_cloud EXIT INT TERM
git -C "$ROOT" archive --format=tar HEAD | tar -xf - -C "$DEPLOY_DIR"
node --input-type=module - "$ROOT/wrangler.jsonc" "$CONFIG_TEMP" "$WORKER_NAME" "$PUBLIC_ORIGIN" "$OWNER_EMAIL" "$APP_VERSION" <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
const [src,dst,name,origin,email,version]=process.argv.slice(2);
const config=JSON.parse(await readFile(src,'utf8'));
config.name=name;
config.vars={...(config.vars||{}),AGORA_DEPLOYMENT_ENV:'production',AGORA_DEPLOYMENT_TYPE:'community',AGORA_DEPLOYMENT_TARGET:'cloudflare-worker',AGORA_VERSION:version,AGORA_PAYMENT_PROVIDER:'stripe',AGORA_STRIPE_MODE:'test',AGORA_PUBLIC_ORIGIN:origin,AGORA_OWNER_EMAIL:email};
await writeFile(dst,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
NODE
mv "$CONFIG_TEMP" "$CONFIG"

echo "Deploying Worker $WORKER_NAME with Stripe test mode and its own Durable Object namespace…"
npx --no-install wrangler deploy --config "$CONFIG" --secrets-file "$SECRETS" > "$STATE_DIR/worker-deploy.log" 2>&1 || { chmod 600 "$STATE_DIR/worker-deploy.log"; echo 'Cloudflare Worker deploy failed. Review the private log file path shown below; secret values are not printed.' >&2; echo "$STATE_DIR/worker-deploy.log" >&2; exit 1; }
chmod 600 "$STATE_DIR/worker-deploy.log"
WORKER_URL="$(node --input-type=module - "$STATE_DIR/worker-deploy.log" "$WORKER_NAME" <<'NODE'
import { readFile } from 'node:fs/promises';
const [file,name]=process.argv.slice(2);const text=await readFile(file,'utf8');const matches=[...text.matchAll(/https:\/\/([a-z0-9-]+\.[a-z0-9.-]+\.workers\.dev)/gi)].map(m=>`https://${m[1]}`).filter(u=>new URL(u).hostname.startsWith(`${name}.`));if(matches.length)process.stdout.write(matches.at(-1));
NODE
)"
[[ "$WORKER_URL" =~ ^https://[a-z0-9-]+\.[a-z0-9.-]+\.workers\.dev$ ]] || { echo "Could not determine the deployed Worker URL. Inspect the private Wrangler log at $STATE_DIR/worker-deploy.log." >&2; exit 1; }

if ! vercel project inspect "$UI_PROJECT" --json --yes >/dev/null 2>&1; then
  echo "Creating separate Vercel community UI project ${UI_PROJECT}…"
  vercel project add "$UI_PROJECT" >/dev/null
fi
# Projects created with `vercel project add` have no framework preset. Set the
# expected Next.js builder explicitly so the production alias serves the app.
vercel project update "$UI_PROJECT" --framework nextjs --node-version 24.x --yes >/dev/null
vercel link --cwd "$DEPLOY_DIR" --project "$UI_PROJECT" --yes >/dev/null
vercel env add AGORA_API_ORIGIN production --value "$WORKER_URL" --force --yes --project "$UI_PROJECT" --cwd "$DEPLOY_DIR" >/dev/null
echo "Deploying the separate Vercel UI project ${UI_PROJECT}…"
if ! vercel deploy "$DEPLOY_DIR" --prod --yes --project "$UI_PROJECT" --build-env "AGORA_API_ORIGIN=$WORKER_URL" --env "AGORA_API_ORIGIN=$WORKER_URL" --json > "$STATE_DIR/vercel-deploy.log" 2>&1; then
  chmod 600 "$STATE_DIR/vercel-deploy.log"
  echo 'Vercel UI deploy failed. Review its private log file and rerun the same command; Worker credentials and Durable Object data are preserved.' >&2
  echo "$STATE_DIR/vercel-deploy.log" >&2
  exit 1
fi
chmod 600 "$STATE_DIR/vercel-deploy.log"
if ! node --input-type=module - "$PUBLIC_ORIGIN" "$WORKER_URL" <<'NODE'
const [origin,worker]=process.argv.slice(2);for(let i=0;i<30;i++){try{const r=await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(3000)});const h=await r.json();if(r.ok&&h.deployment_type==='community'&&h.deployment_target==='cloudflare-worker'&&h.provider?.mode==='test')process.exit(0)}catch{}await new Promise(r=>setTimeout(r,1000))}process.exit(1)
NODE
then
  echo "The paired UI did not pass the community Worker health check at $PUBLIC_ORIGIN. State and credentials are preserved; inspect $STATE_DIR/vercel-deploy.log and rerun --update after correcting the alias." >&2
  exit 1
fi

node --input-type=module - "$STATE_DIR/install.json" "$WORKER_NAME" "$PUBLIC_ORIGIN" "$OWNER_EMAIL" "$UI_PROJECT" "$WORKER_URL" <<'NODE'
import { chmod, rename, writeFile } from 'node:fs/promises';
const [path,name,origin,email,project,worker]=process.argv.slice(2);const tmp=`${path}.${process.pid}.tmp`;
await writeFile(tmp,JSON.stringify({format:1,worker_name:name,owner_email:email,ui_project:project,worker_url:worker,public_origin:origin,deployment_target:'cloudflare-worker',provider:'stripe',mode:'test',updated_at:new Date().toISOString()},null,2)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,path);await chmod(path,0o600);
NODE
rm -f "$PENDING"
cat <<RESULT

Worker deployment completed. Bootstrap credentials are stored privately at:
$CREDENTIALS

Open that file locally to sign in, enroll MFA, and configure Stripe TEST credentials.
The paired Vercel UI is available at: $PUBLIC_ORIGIN
The API Worker is available at: $WORKER_URL
The installer keeps API routing in the Vercel server configuration; no Cloudflare token is placed in the browser.
Use the private state file at $MANIFEST for idempotent redeploys; update with `bash install.sh --target cloudflare --worker-name $WORKER_NAME --owner-email $OWNER_EMAIL --update`.
The current experimental Vercel project was not changed. This command creates no charges.
RESULT
