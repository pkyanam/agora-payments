#!/usr/bin/env bash
# Install Agora Community into an existing or newly created Boat sandbox.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
has_tty() { [[ -r /dev/tty ]] && (true </dev/tty) 2>/dev/null; }
prompt() {
  local question="$1" answer
  printf '%s' "$question" > /dev/tty
  IFS= read -r answer < /dev/tty || answer=
  printf '%s' "$answer"
}
fail() { printf 'Agora Boat installer: %s\n' "$1" >&2; exit 1; }

BOAT_ID=""
CREATE=0
CREATED=0
TYPE=default
TYPE_SET=0
TTL=3600
TTL_SET=0
NO_AUTO_STOP=0
OWNER_EMAIL=""
APP_DIR=""
PORT=3000
PORT_SET=0
UPDATE=0
NON_INTERACTIVE=0
RESUME=0
while (($#)); do
  case "$1" in
    --target) [[ "${2:-}" == boat ]] || fail 'Only --target boat is accepted here.'; shift 2 ;;
    --target=boat) shift ;;
    --boat-id) BOAT_ID="${2:?Missing value for --boat-id}"; shift 2 ;;
    --create-boat) CREATE=1; shift ;;
    --type) TYPE="${2:?Missing value for --type}"; TYPE_SET=1; shift 2 ;;
    --ttl) TTL="${2:?Missing value for --ttl}"; TTL_SET=1; shift 2 ;;
    --no-auto-stop) NO_AUTO_STOP=1; shift ;;
    --owner-email) OWNER_EMAIL="${2:?Missing value for --owner-email}"; shift 2 ;;
    --dir) APP_DIR="${2:?Missing value for --dir}"; shift 2 ;;
    --port) PORT="${2:?Missing value for --port}"; PORT_SET=1; shift 2 ;;
    --update) UPDATE=1; shift ;;
    --resume) RESUME=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --help|-h)
      cat <<'USAGE'
Agora Community Boat installer

Usage: bash community-install.sh --target boat [options]
  --boat-id ID          Install or update inside an existing running sandbox
  --create-boat         Create a new small/standard Boat sandbox
  --type TYPE           Machine size for a new sandbox (default: default)
  --ttl SECONDS         Auto-stop lifetime for a new sandbox (default: 3600)
  --no-auto-stop        Keep a new sandbox running until stopped; billed while on
  --resume              Resume a selected stopped sandbox (may incur compute charges)
  --owner-email EMAIL   First owner account email (required for a fresh install)
  --dir ABSOLUTE_PATH   Remote app directory (default: ~/.local/share/agora)
  --port PORT           App and Boat hosted port (default: 3000)
  --update              Update an existing Boat installation without rotating secrets
  --non-interactive     Disable prompts; requires --boat-id or --create-boat

Without --boat-id or --create-boat, the installer lists your sandboxes and asks
whether to use one or create a new one. New sandboxes default to auto-stop after
one hour. Disabling auto-stop may require a payment method and bills compute for
as long as the sandbox runs. The default machine is 4 vCPU / 8 GB; `small` is
2 vCPU / 4 GB at half rate. `large` is 2x the default rate. `xlarge` costs $0.20/hour and requires a $100+ plan and operator allocation.
USAGE
      exit 0
      ;;
    *) fail "Unknown option: $1" ;;
  esac
done

[[ -z "$BOAT_ID" || $CREATE == 0 ]] || fail 'Choose either --boat-id or --create-boat, not both.'
((CREATE || TYPE_SET == 0)) || [[ -z "$BOAT_ID" ]] || fail '--type only applies when creating a sandbox.'
((CREATE || TTL_SET == 0)) || [[ -z "$BOAT_ID" ]] || fail '--ttl only applies when creating a sandbox.'
((CREATE == 0 || RESUME == 0)) || fail '--resume only applies to an existing sandbox.'
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT > 0 && PORT < 65536)) || fail '--port must be from 1 to 65535.'
[[ "$TYPE" =~ ^(small|default|large|xlarge)$ ]] || fail '--type must be small, default, large, or xlarge.'
[[ "$TTL" =~ ^[0-9]+$ ]] && ((TTL > 0)) || fail '--ttl must be a positive number of seconds.'
[[ -z "$APP_DIR" || ( "$APP_DIR" == /* && "$APP_DIR" != *[[:space:]]* ) ]] || fail '--dir must be an absolute path without spaces inside the sandbox.'
if ((UPDATE)) && [[ -z "$BOAT_ID" ]]; then fail '--update requires --boat-id.'; fi
if ((NO_AUTO_STOP)) && ((CREATE == 0)) && [[ -z "$BOAT_ID" ]]; then fail '--no-auto-stop applies only when creating a new sandbox.'; fi
if ((NO_AUTO_STOP)) && [[ -n "$BOAT_ID" ]]; then fail '--no-auto-stop only applies when creating a sandbox; change an existing sandbox with `boat extend ID --no-auto-stop`.'; fi

if [[ -z "$BOAT_ID" ]] && ((CREATE == 0)); then
  ((NON_INTERACTIVE == 0)) || fail 'Use --boat-id ID or --create-boat with --non-interactive.'
  has_tty || fail 'An interactive terminal is required to choose an existing or new Boat sandbox.'
  printf 'Your Boat sandboxes:\n' > /dev/tty
  boat list --all
  choice="$(prompt 'Use an existing sandbox or create one? [existing/create] (existing): ')"
  case "${choice:-existing}" in
    existing)
      BOAT_ID="$(prompt 'Sandbox ID: ')"
      ;;
    create)
      CREATE=1
      ;;
    *) fail 'Choose existing or create.' ;;
  esac
fi

if [[ -n "$BOAT_ID" ]]; then
  ((NO_AUTO_STOP == 0)) || fail '--no-auto-stop only applies when creating a sandbox; change an existing sandbox with `boat extend ID --no-auto-stop`.'
  ((TYPE_SET == 0)) || fail '--type only applies when creating a sandbox.'
  ((TTL_SET == 0)) || fail '--ttl only applies when creating a sandbox.'
fi

if ((CREATE)); then
  [[ -z "$BOAT_ID" ]] || fail 'Cannot create a sandbox while --boat-id is set.'
  if ((NO_AUTO_STOP == 0 && NON_INTERACTIVE == 0)); then
    has_tty || fail 'Use --no-auto-stop only after deciding to pay for continuous runtime.'
    answer="$(prompt 'Disable Boat auto-stop? The sandbox will keep billing while it runs and may require a payment method. [y/N] ')"
    [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]] && NO_AUTO_STOP=1
  fi
  if ((NO_AUTO_STOP)) && ((NON_INTERACTIVE == 0)); then
    answer="$(prompt 'Confirm continuous Boat compute billing by typing YES: ')"
    [[ "$answer" == YES ]] || fail 'Creation cancelled; no sandbox was started.'
  fi
fi


if [[ -n "$OWNER_EMAIL" ]]; then
  [[ "$OWNER_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail 'Provide a valid --owner-email.'
fi

command -v boat >/dev/null 2>&1 || fail 'Install Boat CLI first (https://boat.dev/install), then run `boat onboard`.'
boat status --no-update >/dev/null || fail 'Boat is not signed in or its API is unavailable. Run `boat onboard`, then retry.'

if ((CREATE)); then
  new_args=(new --no-env --type "$TYPE" --ttl "$TTL" --json)
  ((NO_AUTO_STOP == 0)) || { new_args=(new --no-env --type "$TYPE" --no-auto-stop --json); }
  printf 'Creating a Boat sandbox (%s machine, %s)...\n' "$TYPE" "$([[ $NO_AUTO_STOP == 1 ]] && printf 'no auto-stop' || printf 'auto-stops after %s seconds' "$TTL")"
  new_output="$(boat "${new_args[@]}")" || fail 'Boat could not create the sandbox. Check `boat limits` and `boat billing`.'
  BOAT_ID="$(printf '%s\n' "$new_output" | sed -nE 's/.*(bx_[[:alnum:]]+).*/\1/p' | head -n 1)"
  [[ "$BOAT_ID" =~ ^bx_[[:alnum:]]+$ ]] || { printf '%s\n' "$new_output" >&2; fail 'Could not identify the new sandbox ID from Boat output.'; }
  printf 'Created sandbox %s.\n' "$BOAT_ID"
  CREATED=1
fi

[[ "$BOAT_ID" =~ ^bx_[[:alnum:]]+$ ]] || fail 'Provide a valid Boat sandbox ID such as bx_….'
info="$(boat info "$BOAT_ID" --json --no-update)" || fail "Boat could not inspect sandbox $BOAT_ID."
state="$(printf '%s' "$info" | grep -Eo '"(state|status)"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n 1 | sed -E 's/.*"(state|status)"[[:space:]]*:[[:space:]]*"([^"]+)".*/\2/' | tr '[:upper:]' '[:lower:]' || true)"
case "$state" in
  stopped)
  if ((RESUME == 0)); then
    if ((NON_INTERACTIVE)); then fail "Sandbox $BOAT_ID is stopped. Run `boat resume $BOAT_ID`, or pass --resume."; fi
    answer="$(prompt "Sandbox $BOAT_ID is stopped. Resume it? This starts billable compute. [y/N] ")"
    [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]] || fail 'No sandbox was resumed.'
  fi
  boat resume "$BOAT_ID" --no-update || fail "Could not resume sandbox $BOAT_ID."
  ;;
  running|up|ready|active|idle) ;;
  *) fail "Sandbox state is '${state:-unknown}', not running. Start or resume it with Boat, then retry." ;;
esac

REMOTE_DIR="$APP_DIR"
[[ -n "$REMOTE_DIR" ]] || REMOTE_DIR=''
SOURCE_COMMIT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail 'Cannot pin the remote installer to this source checkout commit.'
REMOTE_DIR_B64="$(printf '%s' "$REMOTE_DIR" | base64 | tr -d '\r\n')"
OWNER_EMAIL_B64="$(printf '%s' "$OWNER_EMAIL" | base64 | tr -d '\r\n')"

printf 'Installing Agora into sandbox %s on port %s.\n' "$BOAT_ID" "$PORT"
printf 'The public URL will be enabled only after the app passes its health check.\n'
if ! boat ssh "$BOAT_ID" -- env AGORA_REMOTE_DIR_B64="$REMOTE_DIR_B64" AGORA_REMOTE_PORT="$PORT" AGORA_REMOTE_PORT_EXPLICIT="$PORT_SET" AGORA_REMOTE_OWNER_EMAIL_B64="$OWNER_EMAIL_B64" AGORA_REMOTE_UPDATE="$UPDATE" AGORA_SOURCE_COMMIT="$SOURCE_COMMIT" bash -s < "$ROOT/install-boat-remote.sh"; then
  printf 'Boat setup did not finish. Sandbox %s remains available; it was not deleted.\n' "$BOAT_ID" >&2
  if ((CREATED)); then printf 'To pause compute while keeping its snapshot, run: boat stop %s\n' "$BOAT_ID" >&2; fi
  exit 1
fi

printf '\nBoat sandbox: %s\n' "$BOAT_ID"
printf 'Inspect it with `boat info %s`; stop it with `boat stop %s` when you want to pause compute.\n' "$BOAT_ID" "$BOAT_ID"
