#!/usr/bin/env bash
# /scripts/smoke/smoke.sh
# NowVibin — modular smoke test runner (gateway-first, versioned)
# macOS Bash 3.2 friendly (no process substitution, no associative arrays)
#
# Usage:
#   bash scripts/smoke/smoke.sh --list
#   bash scripts/smoke/smoke.sh [--no-jq] [--silent] <id|id,id|a-b|all>
#
# WHY:
# - Enforces gateway-only testing for consistency with prod trust boundary
# - Plumbs API_VERSION for /api/<slug>.<version>/... paths
# - Loads split libs (s2s.sh minting; smoke.lib.sh shared helpers) without < <(…)

set -euo pipefail

# --- Layout ------------------------------------------------------------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_SHARED="$ROOT/smoke.lib.sh"
LIB_S2S="$ROOT/lib/s2s.sh"
TEST_DIR="$ROOT/tests"

# --- Flags -------------------------------------------------------------------
NV_USE_JQ=1
NV_QUIET=0
NV_LIST=0
while [[ "${1-}" == --* ]]; do
  case "$1" in
    --no-jq) NV_USE_JQ=0; shift;;
    --silent|--quiet) NV_QUIET=1; shift;;
    --list) NV_LIST=1; shift;;
    *) break;;
  esac
done
export NV_USE_JQ NV_QUIET

# --- API version (default V1) ------------------------------------------------
API_VERSION="${API_VERSION:-V1}"
export API_VERSION

# --- Load libs (no process substitution) ------------------------------------
if [[ ! -f "$LIB_SHARED" ]]; then echo "Missing $LIB_SHARED" >&2; exit 1; fi
if [[ ! -f "$LIB_S2S"    ]]; then echo "Missing $LIB_S2S"    >&2; exit 1; fi
# shellcheck source=/dev/null
. "$LIB_S2S"
# shellcheck source=/dev/null
. "$LIB_SHARED"

# --- Discover & load tests (plain glob loop) --------------------------------
if [[ ! -d "$TEST_DIR" ]]; then echo "Missing $TEST_DIR" >&2; exit 1; fi

NV_TEST_FILES=()
for f in "$TEST_DIR"/*.sh; do
  [[ -f "$f" ]] && NV_TEST_FILES+=("$f")
done

if [[ ${#NV_TEST_FILES[@]} -eq 0 ]]; then
  echo "No tests found in $TEST_DIR" >&2; exit 1
fi

for f in "${NV_TEST_FILES[@]}"; do
  # shellcheck source=/dev/null
  . "$f"
done

# Sort internal TESTS by numeric id (delegated to lib; 3.2-safe)
nv_sort_tests

# --- Entry -------------------------------------------------------------------
if [[ $NV_LIST -eq 1 ]]; then
  nv_help
  echo
  nv_print_list
  exit 0
fi

if [[ $# -lt 1 ]]; then
  nv_help
  echo
  nv_print_list
  exit 64
fi

SELECTION="$1"; shift || true

# Expand selection without process substitution
IDS=()
_sel_expanded="$(nv_parse_selection "$SELECTION")"
# here-strings are OK on bash 3.2
while IFS= read -r line; do
  [[ -n "$line" ]] && IDS+=("$line")
done <<< "$_sel_expanded"
unset _sel_expanded

overall=0
if [[ $NV_QUIET -eq 1 ]]; then
  for id in "${IDS[@]}"; do
    if nv_run_one "$id" >/dev/null 2>&1; then
      printf "[PASSED] %s %s\n" "$id" "$(nv_name_for_id "$id")"
    else
      printf "[FAILED] %s %s\n" "$id" "$(nv_name_for_id "$id")"
      overall=1
    fi
  done
  exit $overall
else
  for id in "${IDS[@]}"; do
    if ! nv_run_one "$id"; then overall=1; fi
  done
  exit $overall
fi
