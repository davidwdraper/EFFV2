# backend/tests/smoke/smoke.sh
#!/usr/bin/env bash
set -Eeuo pipefail

# --- Locate repo root ---------------------------------------------------------
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../../.." && pwd))"
cd "$ROOT"

SMOKE_DIR="$ROOT/backend/tests/smoke"
TEST_DIR="$SMOKE_DIR/tests"
LIB="$SMOKE_DIR/lib.sh"

# --- Helpers ------------------------------------------------------------------
has_cmd(){ command -v "$1" >/dev/null 2>&1; }
get_env(){ local f="$1" k="$2"; [ -f "$f" ] || { echo ""; return 0; }; grep -E "^${k}=" "$f" | tail -n1 | cut -d'=' -f2- || true; }

# --- Dependencies -------------------------------------------------------------
for dep in curl jq; do has_cmd "$dep" || { echo "❌ Missing $dep" >&2; exit 2; }; done
[ -f "$LIB" ] || { echo "❌ Missing lib: $LIB" >&2; exit 2; }
# shellcheck disable=SC1090
. "$LIB"

# --- Resolve service base URLs (env override → service .env.dev → defaults) ---
GW_ENV="$ROOT/backend/services/gateway/.env.dev"
SF_ENV="$ROOT/backend/services/svcfacilitator/.env.dev"

GW_PORT="${GATEWAY_PORT:-$(get_env "$GW_ENV" PORT)}"; GW_PORT="${GW_PORT:-4000}"
SF_PORT="${SVCFAC_PORT:-$(get_env "$SF_ENV" PORT)}"; SF_PORT="${SF_PORT:-4015}"

export GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://127.0.0.1:${GW_PORT}}"
export SVCFAC_BASE_URL="${SVCFAC_BASE_URL:-http://127.0.0.1:${SF_PORT}}"
export TIMEOUT_MS="${TIMEOUT_MS:-3000}"

# --- Discover tests (Bash 3.2 friendly) --------------------------------------
mkdir -p "$TEST_DIR"
TESTS_LIST="$(mktemp -t nv_smoke_list.XXXXXX)"
# No GNU-only flags; plain find + sort
find "$TEST_DIR" -maxdepth 1 -type f -name "*.sh" | sort > "$TESTS_LIST"

TESTS=()
while IFS= read -r line; do
  [ -n "$line" ] && TESTS[${#TESTS[@]}]="$line"
done < "$TESTS_LIST"
rm -f "$TESTS_LIST"

echo "▶ smoke: found ${#TESTS[@]} test(s)"
i=1
for t in "${TESTS[@]}"; do
  echo "  $i) $(basename "$t")"
  i=$((i+1))
done
echo

# --- Run tests ----------------------------------------------------------------
PASS=0
FAIL=0
FAILED_LIST=()

for t in "${TESTS[@]}"; do
  name="$(basename "$t")"
  echo "── running: $name"
  if bash "$t"; then
    echo "✅ PASS: $name"
    PASS=$((PASS+1))
  else
    echo "❌ FAIL: $name"
    FAIL=$((FAIL+1))
    FAILED_LIST+=("$name")
  fi
  echo
done

echo "Summary: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILED_LIST[@]}"; do echo " - $f"; done
  exit 1
fi
