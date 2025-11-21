# backend/tests/smoke/lib.sh
#!/usr/bin/env bash
# =============================================================================
# NowVibin — Smoke Test Library (macOS Bash 3.2 compatible)
# =============================================================================
# Notes:
# - Adds per-test headers/footers with ✅/❌ result and duration.
# - Captures LAST_HTTP_CODE for every request and prints "HTTP <code>".
# - Zero changes required in existing tests; this file is sourced at top.
# - NEW: DTO_TYPE exported from smoke.sh; defaults to SLUG when not set.
# - Newer smoke.sh sets SMOKE_QUIET_HEADERS=1 to let the runner own the
#   per-test 4-line header/summary; all other helpers still work as-is.
# =============================================================================
set -Eeuo pipefail

: "${TIMEOUT_MS:=3000}"

# ------------------------------- utils ----------------------------------------
_has_cmd(){ command -v "$1" >/dev/null 2>&1; }
_req_time(){ echo "$(( (TIMEOUT_MS+999)/1000 ))"; }

# Best-effort millis on macOS without GNU date; fallback to seconds
_now_secs(){ date +%s; }
# Duration (sec) from START_TS to now
_duration(){
  local start="${1:-0}" end
  end="$(_now_secs)"
  echo "$(( end - start ))s"
}

# ------------------------------ discovery -------------------------------------
# Resolve SMOKE_DIR when sourced directly
if [ -z "${SMOKE_DIR:-}" ]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../../.." && pwd))"
  SMOKE_DIR="$ROOT/backend/tests/smoke"
fi
STATE_DIR="$SMOKE_DIR/.state"; mkdir -p "$STATE_DIR"

# Namespacing for state files (slug + port)
SLUG="${SLUG:-xxx}"
PORT="${PORT:-4015}"
DTO_TYPE="${DTO_TYPE:-$SLUG}"
: "${SMOKE_KEY:=${SLUG}-${PORT}}"

STATE_ID_FILE="$STATE_DIR/${SMOKE_KEY}.id"
STATE_PAYLOAD_FILE="$STATE_DIR/${SMOKE_KEY}.create.json"

# Determine test name (works whether sourced or executed)
# shellcheck disable=SC2128
_TEST_NAME_DEFAULT="$(basename "${BASH_SOURCE[1]:-${0##*/}}")"
TEST_NAME="${SMOKE_TEST_NAME:-${_TEST_NAME_DEFAULT}}"

# Pretty markers
_CHECK="✅"
_CROSS="❌"

# -------------------------- test header/footer --------------------------------
: "${SMOKE_QUIET_HEADERS:=0}"   # set to 1 to suppress headers/footers

_SMOKE_START_TS="$(_now_secs)"

_smoke_header(){
  [ "$SMOKE_QUIET_HEADERS" = "1" ] && return 0
  echo "" >&2
  echo "==============================================================================" >&2
  echo "TEST: ${TEST_NAME}  (SLUG=${SLUG} DTO_TYPE=${DTO_TYPE} PORT=${PORT} HOST=${HOST:-127.0.0.1})" >&2
  echo "==============================================================================" >&2
}

_smoke_footer(){
  [ "$SMOKE_QUIET_HEADERS" = "1" ] && return 0
  local status="$1" dur
  dur="$(_duration "$_SMOKE_START_TS")"
  if [ "$status" -eq 0 ]; then
    echo "${_CHECK} PASS: ${TEST_NAME}  [${dur}]" >&2
  else
    echo "${_CROSS} FAIL: ${TEST_NAME}  [${dur}]" >&2
  fi
  echo "" >&2
}

# Print header immediately when sourced
_smoke_header

# On exit of the test script that sourced this file, print PASS/FAIL footer
_smoke_on_exit(){
  local rc=$?
  _smoke_footer "$rc"
  exit "$rc"
}
# Ensure we’re the last EXIT trap installed (tests rarely set one; if they do, ours still runs)
trap _smoke_on_exit EXIT

# ------------------------------- logging --------------------------------------
_log_url(){ echo "→ ${1} ${2}" >&2; }

# --------------------------- curl core & wrappers ------------------------------
# Emits body to stdout, sets LAST_HTTP_CODE, prints "HTTP <code>" to stderr
_curl_json_core(){
  local method="$1" url="$2" body="${3:-}" extra=()
  case "$method" in
    PUT)    extra=(-H 'content-type: application/json' -X PUT -d "$body");;
    DELETE) extra=(-X DELETE);;
    GET)    extra=();;
  esac

  # Output body + trailing http code, then split
  local out code body_only
  out="$(curl -sS --max-time "$(_req_time)" -w "\n%{http_code}" ${extra+"${extra[@]}"} "$url")" || {
    code="$(printf "%s" "$out" | awk 'END{print $0}')"
    [ -n "$code" ] || code="0"
    export LAST_HTTP_CODE="$code"
    echo "HTTP $code" >&2
    # Print any body lines except the last code line
    printf "%s" "$out" | sed '$d'
    return 22
  }
  code="$(printf "%s" "$out" | awk 'END{print $0}')"
  body_only="$(printf "%s" "$out" | sed '$d')"
  export LAST_HTTP_CODE="$code"
  echo "HTTP $code" >&2
  printf "%s" "$body_only"
}

_get_json(){
  local url="$1"
  _log_url "GET" "$url"
  _curl_json_core "GET" "$url"
}

_put_json(){
  local url="$1" body="$2"
  _log_url "PUT" "$url"
  _curl_json_core "PUT" "$url" "$body"
}

# Canonical DELETE helper used by tests
_delete_json(){
  local url="$1"
  _log_url "DELETE" "$url"
  _curl_json_core "DELETE" "$url"
}

# Back-compat alias (in case any older test used _del_json)
_del_json(){
  _delete_json "$@"
}

# ------------------------------- assertions -----------------------------------
json_eq(){ local body="$1" expr="$2" expect="$3"; [[ "$(jq -er "$expr" <<<"$body")" == "$expect" ]]; }

# Pass/Fail helpers that tests can opt into (no requirement)
pass(){ printf "%s %s\n" "$_CHECK" "${*:-OK}"; }
fail(){ printf "%s %s\n" "$_CROSS" "${*:-FAIL}" >&2; return 1; }
# printf-style variants
passf(){ # usage: passf "deleted id=%s" "$id"
  # shellcheck disable=SC2059
  printf "$_CHECK %s\n" "$(printf "${1:-OK}" "${@:2}")"
}
failf(){ # usage: failf "expected %s, got %s" "$a" "$b"
  # shellcheck disable=SC2059
  printf "$_CROSS %s\n" "$(printf "${1:-FAIL}" "${@:2}")" >&2
  return 1
}

# Extract canonical DTO id from the new bag-first shape.
# Contract:
#   - { ok:true, items:[ { _id, ... } ] }
#   - (optional tolerance) { ok:true, items:[ { doc:{ _id, ... } } ] }
extract_id(){
  local body="$1"
  jq -er '
        .items[0]._id
     // .items[0].doc._id
     // empty
  ' <<<"$body"
}

# ------------------------------- state helpers --------------------------------
save_last_id(){
  local id="$1"
  [ -n "$id" ] || { echo "save_last_id: empty id" >&2; return 1; }
  printf "%s" "$id" > "$STATE_ID_FILE"
  echo "state: saved id=$id → $STATE_ID_FILE" >&2
}
load_last_id(){ [ -f "$STATE_ID_FILE" ] && cat "$STATE_ID_FILE" || echo ""; }
require_last_id(){
  local id
  id="$(load_last_id)"
  [ -n "$id" ] || {
    echo "ERROR: no saved id in $STATE_ID_FILE (run create test 002 first)" >&2
    exit 2
  }
  printf "%s" "$id"
}

save_create_payload(){
  local json="$1"
  echo "$json" | jq -e . >/dev/null || { echo "save_create_payload: not JSON" >&2; return 1; }
  printf "%s" "$json" > "$STATE_PAYLOAD_FILE"
  echo "state: saved create payload → $STATE_PAYLOAD_FILE" >&2
}
load_create_payload(){ [ -f "$STATE_PAYLOAD_FILE" ] && cat "$STATE_PAYLOAD_FILE" || echo ""; }
require_create_payload(){
  local j
  j="$(load_create_payload)"
  [ -n "$j" ] || {
    echo "ERROR: no saved payload in $STATE_PAYLOAD_FILE (run create test 002 first)" >&2
    exit 2
  }
  printf "%s" "$j"
}

# ------------------------------ conveniences ----------------------------------
# Legacy helper: base path up to /api/<slug>/v1
# Existing tests that append "/xxx/..." can keep using this until we migrate
svc_base_for_xxx(){
  local base="${SVCFAC_BASE_URL:-http://${HOST:-127.0.0.1}:${PORT:-4015}}"
  printf "%s/api/%s/v1" "$base" "${SLUG:-xxx}"
}

# New helper (for migrated tests): full base including dtoType:
#   /api/<slug>/v1/<dtoType>
svc_base_for_type(){
  local base="${SVCFAC_BASE_URL:-http://${HOST:-127.0.0.1}:${PORT:-4015}}"
  printf "%s/api/%s/v1/%s" "$base" "${SLUG:-xxx}" "${DTO_TYPE:-${SLUG:-xxx}}"
}
