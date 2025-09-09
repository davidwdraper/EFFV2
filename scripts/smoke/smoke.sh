#!/usr/bin/env bash
# scripts/smoke/smoke.sh
# NowVibin — modular smoke test runner (one file per test)
# macOS Bash 3.2 friendly
# Usage:
#   bash scripts/smoke/smoke.sh --list
#   bash scripts/smoke/smoke.sh [--no-jq] [--silent] <id|id,id|a-b|all>

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$ROOT/smoke.lib.sh"
TEST_DIR="$ROOT/tests"

# ---- Flags ------------------------------------------------------------------
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

# ---- Load lib ---------------------------------------------------------------
if [[ ! -f "$LIB" ]]; then echo "Missing $LIB" >&2; exit 1; fi
# shellcheck source=/dev/null
. "$LIB"

# ---- Discover & load tests (each file registers one test) -------------------
if [[ ! -d "$TEST_DIR" ]]; then echo "Missing $TEST_DIR" >&2; exit 1; fi

NV_TEST_FILES=()
while IFS= read -r f; do NV_TEST_FILES+=("$f"); done < <(LC_ALL=C ls -1 "$TEST_DIR"/*.sh 2>/dev/null || true)

if [[ ${#NV_TEST_FILES[@]} -eq 0 ]]; then
  echo "No tests found in $TEST_DIR" >&2; exit 1
fi

for f in "${NV_TEST_FILES[@]}"; do
  # shellcheck source=/dev/null
  . "$f"
done

# sort internal TESTS by numeric id (stable)
nv_sort_tests

# ---- Entry ------------------------------------------------------------------
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

# macOS Bash 3.2 safe expansion
IDS=()
_selection_expanded="$(nv_parse_selection "$SELECTION")"
while IFS= read -r line; do [[ -n "$line" ]] && IDS+=("$line"); done <<< "$_selection_expanded"
unset _selection_expanded

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
