#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agora-community-installer-test.XXXXXX")"
trap 'rm -rf -- "$TEST_DIR"' EXIT INT TERM

MOCK_BIN="$TEST_DIR/bin"
mkdir -p "$MOCK_BIN"
cat > "$MOCK_BIN/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == clone && "$2" == --depth && "$3" == 1 ]]
[[ "$4" == https://github.com/pkyanam/agora-payments.git ]]
mkdir -p "$5"
cat > "$5/install.sh" <<'INSTALL'
#!/usr/bin/env bash
printf 'community installer reached; args=%s\n' "$*"
INSTALL
EOF
chmod 755 "$MOCK_BIN/git"

OUTPUT="$(env -i PATH="$MOCK_BIN:/usr/bin:/bin" HOME="$TEST_DIR/home" bash "$ROOT/community-install.sh" --help)"
[[ "$OUTPUT" == 'community installer reached; args=--help' ]]
printf '%s\n' 'PASS: anonymous public GitHub clone path works without GitHub CLI.'
