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
# Options (new):
# - --slug <slug>   : service slug (default: xxx)
# - --port <port>   : service port (default: 4015)
# - --host <host>   : host (default: 127.0.0.1)
#
# Notes:
# - Exports SLUG/PORT/HOST for child test scripts.
# - Merges STDERR into STDOUT so per-request URL traces are visible.
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
normalize_id(){ local s="$1"; echo $((10#$s)); }

usage() {
  echo "Usage:"
  echo "  $(basename "$0")                 # list tests"
  echo "  $(basename "$0") --all [opts]    # run all tests"
  echo "  $(basename "$0") <ID> [opts]     # run a single test"
  echo "Options:"
  echo "  --slug <slug>    Service slug (default: xxx)"
  echo "  --port <port>    Service port (default: 4015)"
  echo "  --host <host>    Host (default: 127.0.0.1)"
}

# --- Dependencies -------------------------------------------------------------
for dep in curl jq; do has_cmd "$dep" || { echo "❌ Missing $dep" >&2; exit 2; }; done
[ -f "$LIB" ] || { echo "❌ Missing lib: $LIB" >&2; exit 2; }
# shellcheck disable=SC1090
. "$LIB"

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

# --- Defaults for service under test -----------------------------------------
SLUG="xxx"
PORT="4015"
HOST="127.0.0.1"

# --- Arg parsing --------------------------------------------------------------
if [ $# -eq 0 ]; then
  echo "▶ smoke: found ${COUNT} test(s)"
  for (( i=0; i<COUNT; i++ )); do
    echo "  ${IDS[$i]}) $(basename "${FILES[$i]}")"
  done
  echo
  usage
  exit 0
fi

RUN_MODE=""
REQ_ID_RAW=""

while [ $# -gt 0 ]; do
  case "${1:-}" in
    --help|-h) usage; exit 0 ;;
    --all) RUN_MODE="all"; shift ;;
    --slug) SLUG="${2:?}"; shift 2 ;;
    --port) PORT="${2:?}"; shift 2 ;;
    --host) HOST="${2:?}"; shift 2 ;;
    *)
      if echo "$1" | grep -Eq '^[0-9]+$'; then
        REQ_ID_RAW="$1"; RUN_MODE="single"; shift
      else
        echo "❌ Unknown arg: $1" >&2; echo; usage; exit 2
      fi
      ;;
  esac
done

# --- Validate / resolve selected test ----------------------------------------
if [ -z "${RUN_MODE}" ]; then
  echo "❌ Must specify --all or a numeric test ID." >&2
  echo; usage; exit 2
fi

RUN_IDX=-1
if [ "$RUN_MODE" = "single" ]; then
  req_n="$(normalize_id "$REQ_ID_RAW")"
  found=0
  for (( i=0; i<COUNT; i++ )); do
    cur_n="$(normalize_id "${IDS[$i]}")"
    if [ "$cur_n" -eq "$req_n" ]; then RUN_IDX="$i"; found=1; break; fi
  done
  if [ "$found" -ne 1 ]; then
    echo "❌ No test with ID: $REQ_ID_RAW" >&2
    echo "Available tests:"; for (( i=0; i<COUNT; i++ )); do echo "  ${IDS[$i]}  $(basename "${FILES[$i]}")"; done
    exit 2
  fi
fi

# --- Export service vars for child tests -------------------------------------
export SLUG PORT HOST

# --- Runner helpers -----------------------------------------------------------
run_test() {
  local tpath="$1"
  local name; name="$(basename "$tpath")"
  echo "── running: $name  (SLUG=${SLUG} PORT=${PORT} HOST=${HOST})"
  set +e
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
    if run_test "${FILES[$i]}"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILED_LIST+=("$(basename "${FILES[$i]}")"); fi
  done
else
  echo
  if run_test "${FILES[$RUN_IDX]}"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILED_LIST+=("$(basename "${FILES[$RUN_IDX]}")"); fi
fi

echo
echo "Summary: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILED_LIST[@]}"; do echo " - $f"; done
  exit 1
fi
exit 0
