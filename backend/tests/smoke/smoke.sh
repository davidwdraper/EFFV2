# backend/tests/smoke/smoke.sh
#!/usr/bin/env bash
# ============================================================================
# NowVibin — Smoke Test Runner (macOS Bash 3.2 compatible)
# Docs:
# - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
# - ADRs: docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
#
# Behavior:
# - No args: list available tests with their explicit numeric IDs.
# - --all : run all tests in ID order.
# - <ID>  : run a single test by its numeric ID (e.g., 6 or 006 runs 006-*.sh).
# Notes:
# - Merges STDERR into STDOUT so per-request URL traces (from lib.sh) are visible
#   even when tests pass. Exit codes are preserved via PIPESTATUS[0].
# ============================================================================
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
normalize_id(){ # strip leading zeros safely (bash arithmetic, base-10)
  local s="$1"
  echo $((10#$s))
}

usage() {
  echo "Usage:"
  echo "  $(basename "$0")           # list tests"
  echo "  $(basename "$0") --all     # run all tests"
  echo "  $(basename "$0") <ID>      # run a single test by its numeric ID (e.g., 6 or 006)"
}

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
TESTS_FILE="$(mktemp -t nv_smoke_list.XXXXXX)"
find "$TEST_DIR" -maxdepth 1 -type f -name "*.sh" | sort > "$TESTS_FILE"

# Build parallel arrays: IDS[i], FILES[i]
IDS=()
FILES=()
while IFS= read -r t; do
  [ -n "$t" ] || continue
  base="$(basename "$t")"
  if echo "$base" | grep -Eq '^[0-9]+-.*\.sh$'; then
    id="$(echo "$base" | sed -E 's/^([0-9]+).*/\1/')"
    IDS[${#IDS[@]}]="$id"
    FILES[${#FILES[@]}]="$t"
  fi
done < "$TESTS_FILE"
rm -f "$TESTS_FILE"

COUNT="${#FILES[@]}"

# --- No args: list tests and usage, exit -------------------------------------
if [ $# -eq 0 ]; then
  echo "▶ smoke: found ${COUNT} test(s)"
  for (( i=0; i<COUNT; i++ )); do
    echo "  ${IDS[$i]}) $(basename "${FILES[$i]}")"
  done
  echo
  usage
  exit 0
fi

# --- Arg parsing --------------------------------------------------------------
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  usage
  exit 0
fi

RUN_MODE="single"
RUN_IDX=-1
if [ "$1" = "--all" ]; then
  RUN_MODE="all"
else
  REQ_ID_RAW="$1"
  if ! echo "$REQ_ID_RAW" | grep -Eq '^[0-9]+$'; then
    echo "❌ Invalid ID: $REQ_ID_RAW" >&2
    echo
    usage
    exit 2
  fi
  req_n="$(normalize_id "$REQ_ID_RAW")"
  found=0
  for (( i=0; i<COUNT; i++ )); do
    cur_n="$(normalize_id "${IDS[$i]}")"
    if [ "$cur_n" -eq "$req_n" ]; then
      RUN_IDX="$i"
      found=1
      break
    fi
  done
  if [ "$found" -ne 1 ]; then
    echo "❌ No test with ID: $REQ_ID_RAW" >&2
    echo "Available tests:"
    for (( i=0; i<COUNT; i++ )); do echo "  ${IDS[$i]}  $(basename "${FILES[$i]}")"; done
    exit 2
  fi
fi

# --- Runner helpers -----------------------------------------------------------
run_test() {
  local tpath="$1"
  local name; name="$(basename "$tpath")"
  echo "── running: $name"
  # Merge STDERR→STDOUT so URL traces (printed to STDERR by lib.sh) are visible.
  # Preserve the child script's exit code using PIPESTATUS[0].
  set +e  # don't exit on failure until we capture rc
  bash "$tpath" 2>&1 | cat
  local rc=${PIPESTATUS[0]}
  set -e
  if [ $rc -eq 0 ]; then
    echo "✅ PASS: $name"
    return 0
  else
    echo "❌ FAIL: $name"
    return 1
  fi
}

# --- Execute ------------------------------------------------------------------
PASS=0
FAIL=0
FAILED_LIST=()

if [ "$RUN_MODE" = "all" ]; then
  for (( i=0; i<COUNT; i++ )); do
    echo
    if run_test "${FILES[$i]}"; then
      PASS=$((PASS+1))
    else
      FAIL=$((FAIL+1))
      FAILED_LIST+=("$(basename "${FILES[$i]}")")
    fi
  done
else
  echo
  if run_test "${FILES[$RUN_IDX]}"; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    FAILED_LIST+=("$(basename "${FILES[$RUN_IDX]}")")
  fi
fi

echo
echo "Summary: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILED_LIST[@]}"; do echo " - $f"; done
  exit 1
fi
exit 0
