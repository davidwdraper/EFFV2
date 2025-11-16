# backend/tests/smoke/smoke.sh
#!/usr/bin/env bash
# ============================================================================
# NowVibin — Smoke Test Runner (macOS Bash 3.2 compatible)
#
# Layout:
#   backend/tests/smoke/
#     smoke.sh
#     lib.sh
#     tests/
#       <slug>/
#         001-*.sh
#         002-*.sh
#         ...
#
# Test file header convention:
#   line 1: #!/usr/bin/env bash
#   line 2: # backend/tests/smoke/tests/<slug>/<file>.sh
#   line 3: # <test #> One-line description of the test
#
# Behavior:
#   No args:
#     - Show usage.
#
#   --slug <slug> [--port <port>]:
#     - List tests for the slug (no execution if no test spec).
#
#   Run tests:
#     ./smoke.sh --slug <slug> --port <port> [--verbose] --all
#     ./smoke.sh --slug <slug> --port <port> [--verbose] <N>
#     ./smoke.sh --slug <slug> --port <port> [--verbose] <N-M>
#
# Header for each executed test (always shown, verbose or not):
#   -------------------------------------------------------------------------------
#   <test #> One description of test         (from line 3 of test file)
#   backend/tests/smoke/tests/...           (from line 2 of test file)
#   ✅ PASSED   /   ❌ FAILED (exit <code>)
#
# In non-verbose mode, ALL test output is suppressed.
# In verbose mode, test output is shown normally.
# ============================================================================

set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../../.." && pwd))"
cd "$ROOT"

SMOKE_DIR="$ROOT/backend/tests/smoke"
TEST_ROOT_BASE="$SMOKE_DIR/tests"

has_cmd(){ command -v "$1" >/dev/null 2>&1; }
normalize_id(){ local s="$1"; echo $((10#$s)); }

usage() {
  cat <<USAGE
Usage:
  $(basename "$0")                       # show this help
  $(basename "$0") --slug <slug>        # list tests for slug
  $(basename "$0") --slug <slug> --port <port>         # list tests for slug
  $(basename "$0") --slug <slug> --port <port> [--verbose] --all
  $(basename "$0") --slug <slug> --port <port> [--verbose] <ID>
  $(basename "$0") --slug <slug> --port <port> [--verbose] <ID1-ID2>

Options:
  --slug <slug>      Service slug (default: xxx)
  --dtoType <type>   DTO type (default: same as slug)
  --port <port>      Service port (required for execution)
  --host <host>      Host (default: 127.0.0.1)
  --verbose          Show full test output (default: only 4-line header/result)
USAGE
}

# --- Dependencies ------------------------------------------------------------
for dep in curl jq; do
  has_cmd "$dep" || { echo "❌ Missing $dep" >&2; exit 2; }
done

# --- Defaults ----------------------------------------------------------------
SLUG="xxx"
PORT=""          # must be provided via --port for execution
HOST="127.0.0.1"
DTO_TYPE=""      # resolved to SLUG if empty
VERBOSE=0

RUN_MODE="list"      # "list" | "exec"
TEST_SPEC=""         # "", "--all", "N", "N-M"

# --- Arg parsing -------------------------------------------------------------
if [ $# -eq 0 ]; then
  usage
  exit 0
fi

while [ $# -gt 0 ]; do
  case "${1:-}" in
    --help|-h)
      usage
      exit 0
      ;;
    --slug)
      SLUG="${2:?missing slug for --slug}"
      shift 2
      ;;
    --dtoType)
      DTO_TYPE="${2:?missing type for --dtoType}"
      shift 2
      ;;
    --port)
      PORT="${2:?missing port for --port}"
      shift 2
      ;;
    --host)
      HOST="${2:?missing host for --host}"
      shift 2
      ;;
    --verbose)
      VERBOSE=1
      shift
      ;;
    --all)
      RUN_MODE="exec"
      TEST_SPEC="--all"
      shift
      ;;
    *)
      # Test spec: "N" or "N-M"
      if echo "$1" | grep -Eq '^[0-9]+(-[0-9]+)?$'; then
        RUN_MODE="exec"
        TEST_SPEC="$1"
        shift
      else
        echo "❌ Unknown arg: $1" >&2
        echo
        usage
        exit 2
      fi
      ;;
  esac
done

# --- Resolve DTO_TYPE default ------------------------------------------------
if [ -z "${DTO_TYPE}" ]; then
  DTO_TYPE="$SLUG"
fi

# --- Discover tests for this slug --------------------------------------------
TEST_DIR="$TEST_ROOT_BASE/$SLUG"

if [ ! -d "$TEST_DIR" ]; then
  echo "❌ No test directory for slug '${SLUG}': $TEST_DIR" >&2
  exit 2
fi

TESTS_FILE="$(mktemp -t nv_smoke_list.XXXXXX)"
find "$TEST_DIR" -maxdepth 1 -type f -name "*.sh" | sort > "$TESTS_FILE"

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

if [ "$COUNT" -eq 0 ]; then
  echo "❌ No tests found under: $TEST_DIR" >&2
  exit 2
fi

# --- Helpers to read header metadata from test file --------------------------
# line2 = path/filename comment, line3 = one-line description
get_test_path_line() {
  local tpath="$1"
  sed -n '2p' "$tpath" | sed -E 's/^# ?//'
}

get_test_desc_line() {
  local tpath="$1"
  sed -n '3p' "$tpath" | sed -E 's/^# ?//'
}

print_test_header() {
  local tpath="$1"
  local desc path
  desc="$(get_test_desc_line "$tpath")"
  path="$(get_test_path_line "$tpath")"

  # Fallbacks if headers are missing/mis-ordered
  [ -z "$desc" ] && desc="$(basename "$tpath")"
  [ -z "$path" ] && path="$tpath"

  printf '%s\n' "-------------------------------------------------------------------------------"
  printf '%s\n' "$desc"
  printf '%s\n' "$path"
}

# --- List mode ---------------------------------------------------------------
if [ "$RUN_MODE" = "list" ]; then
  echo "▶ smoke: found ${COUNT} test(s) for slug '${SLUG}'"
  for (( i=0; i<COUNT; i++ )); do
    tpath="${FILES[$i]}"
    base="$(basename "$tpath")"
    desc="$(get_test_desc_line "$tpath")"
    [ -z "$desc" ] && desc="$base"
    printf "  %s) %s — %s\n" "${IDS[$i]}" "$base" "$desc"
  done
  echo
  usage
  exit 0
fi

# --- Execution mode: require port --------------------------------------------
if [ -z "${PORT}" ]; then
  echo "❌ Missing required parameter: --port <port> for execution" >&2
  echo
  usage
  exit 2
fi

# --- Export for child test scripts -------------------------------------------
export SLUG PORT HOST DTO_TYPE
# Always keep lib.sh quiet; runner controls headers/footers.
export SMOKE_QUIET_HEADERS=1

# --- Build list of indices to run --------------------------------------------
SELECTED_INDEXES=()

if [ "$TEST_SPEC" = "--all" ]; then
  for (( i=0; i<COUNT; i++ )); do
    SELECTED_INDEXES+=("$i")
  done
else
  # Either "N" or "N-M"
  if echo "$TEST_SPEC" | grep -q '-'; then
    # Range
    start_raw="${TEST_SPEC%-*}"
    end_raw="${TEST_SPEC#*-}"
    start="$(normalize_id "$start_raw")"
    end="$(normalize_id "$end_raw")"
    if [ "$start" -gt "$end" ]; then
      tmp="$start"; start="$end"; end="$tmp"
    fi
    for (( n=start; n<=end; n++ )); do
      found=0
      for (( i=0; i<COUNT; i++ )); do
        cur="$(normalize_id "${IDS[$i]}")"
        if [ "$cur" -eq "$n" ]; then
          SELECTED_INDEXES+=("$i")
          found=1
          break
        fi
      done
      if [ "$found" -ne 1 ]; then
        echo "❌ No test with ID: $n for slug '${SLUG}'" >&2
        exit 2
      fi
    done
  else
    # Single ID
    req_n="$(normalize_id "$TEST_SPEC")"
    found=0
    for (( i=0; i<COUNT; i++ )); do
      cur_n="$(normalize_id "${IDS[$i]}")"
      if [ "$cur_n" -eq "$req_n" ]; then
        SELECTED_INDEXES+=("$i")
        found=1
        break
      fi
    done
    if [ "$found" -ne 1 ]; then
      echo "❌ No test with ID: $TEST_SPEC for slug '${SLUG}'" >&2
      exit 2
    fi
  fi
fi

# --- Runner -------------------------------------------------------------------
run_one_test() {
  local tpath="$1"
  local verbose="$2"

  print_test_header "$tpath"

  local rc=0
  if [ "$verbose" -eq 1 ]; then
    # Full output to console
    bash "$tpath"
    rc=$?
  else
    # Suppress all test output; status only
    if bash "$tpath" >/dev/null 2>&1; then
      rc=0
    else
      rc=$?
    fi
  fi

  if [ "$rc" -eq 0 ]; then
    echo "✅ PASSED"
  else
    echo "❌ FAILED (exit ${rc})"
  fi

  return "$rc"
}

PASS=0
FAIL=0

for idx in "${SELECTED_INDEXES[@]}"; do
  tpath="${FILES[$idx]}"
  if run_one_test "$tpath" "$VERBOSE"; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
  fi
done

echo
echo "Summary: ${PASS} passed, ${FAIL} failed"
exit $([ "$FAIL" -gt 0 ] && echo 1 || echo 0)
