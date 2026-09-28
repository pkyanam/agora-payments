#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agora-local-rerun-test.XXXXXX")"
trap 'rm -rf -- "$TEST_DIR"' EXIT INT TERM
APP_DIR="$TEST_DIR/agora"
mkdir -p "$APP_DIR/state/data"
printf '%s\n' '{"format":1,"install_dir":"test","deployment_target":"node","repository":"pkyanam/agora-payments","git_ref":"main","current_version":"oldversion01","port":3000,"host":"127.0.0.1","public_origin":"http://localhost:3000"}' > "$APP_DIR/install.json"
printf 'keep-this-owner-secret\n' > "$APP_DIR/state/.env.local"
printf 'do-not-overwrite\n' > "$APP_DIR/state/data/agora.sqlite"
cat > "$APP_DIR/update.sh" <<'UPDATE'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == --dir && "$2" == "$TEST_APP_DIR" ]]
printf 'checked-latest-main\n' >> "$TEST_LOG"
UPDATE
chmod 700 "$APP_DIR/update.sh"
export TEST_APP_DIR="$APP_DIR" TEST_LOG="$TEST_DIR/update.log"

# Same public installer entrypoint, non-interactive: it must hand off to the
# existing transactional updater instead of reporting success while unchanged.
bash "$ROOT/install.sh" --dir "$APP_DIR" --non-interactive > "$TEST_DIR/rerun.out"
grep -q '^checked-latest-main$' "$TEST_LOG"
[[ "$(cat "$APP_DIR/state/.env.local")" == keep-this-owner-secret ]]
[[ "$(cat "$APP_DIR/state/data/agora.sqlite")" == do-not-overwrite ]]
[[ "$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).current_version' "$APP_DIR/install.json")" == oldversion01 ]]

# An already-current updater result is reported as a no-op by update.sh itself;
# the installer does not create a new install/owner setup on another invocation.
cat > "$APP_DIR/update.sh" <<'UPDATE'
#!/usr/bin/env bash
set -euo pipefail
printf 'Agora is already current (oldversion01).\n'
UPDATE
chmod 700 "$APP_DIR/update.sh"
bash "$ROOT/install.sh" --dir "$APP_DIR" --non-interactive > "$TEST_DIR/current.out"
grep -q 'already current' "$TEST_DIR/current.out"
[[ "$(cat "$APP_DIR/state/.env.local")" == keep-this-owner-secret ]]
[[ "$(cat "$APP_DIR/state/data/agora.sqlite")" == do-not-overwrite ]]
[[ "$(wc -l < "$TEST_LOG" | tr -d ' ')" == 1 ]]
printf '%s\n' 'PASS: local installer rerun delegates to latest-release updater and preserves config/database when updating or already current.'
