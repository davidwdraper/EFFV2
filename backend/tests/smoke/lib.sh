# backend/tests/smoke/lib.sh
#!/usr/bin/env bash
# =============================================================================
# NowVibin — Smoke Test Library (macOS Bash 3.2 compatible)
# =============================================================================
set -Eeuo pipefail

: "${TIMEOUT_MS:=3000}"

_has_cmd(){ command -v "$1" >/dev/null 2>&1; }
_req_time(){ echo "$(( (TIMEOUT_MS+999)/1000 ))"; }

# Resolve SMOKE_DIR when sourced directly
if [ -z "${SMOKE_DIR:-}" ]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../../.." && pwd))"
  SMOKE_DIR="$ROOT/backend/tests/smoke"
fi
STATE_DIR="$SMOKE_DIR/.state"; mkdir -p "$STATE_DIR"

# --- Namespacing for state files (slug + port) -------------------------------
SLUG="${SLUG:-xxx}"
PORT="${PORT:-4015}"
: "${SMOKE_KEY:=${SLUG}-${PORT}}"

STATE_ID_FILE="$STATE_DIR/${SMOKE_KEY}.id"
STATE_PAYLOAD_FILE="$STATE_DIR/${SMOKE_KEY}.create.json"

# --- Logging (stderr) --------------------------------------------------------
_log_url(){ echo "→ ${1} ${2}" >&2; }

# --- Curl wrappers -----------------------------------------------------------
_get_json(){ local url="$1"; _log_url "GET" "$url"; curl -sS --max-time "$(_req_time)" "$url"; }
_put_json(){ local url="$1" body="$2"; _log_url "PUT" "$url"; curl -sS --max-time "$(_req_time)" -H 'content-type: application/json' -X PUT -d "$body" "$url"; }
_del_json(){ local url="$1"; _log_url "DELETE" "$url"; curl -sS --max-time "$(_req_time)" -X DELETE "$url"; }

# --- Assertions --------------------------------------------------------------
json_eq(){ local body="$1" expr="$2" expect="$3"; [[ "$(jq -er "$expr" <<<"$body")" == "$expect" ]]; }

# --- ID extraction (slug-aware; no DB _id fallback) --------------------------
# Returns the first present of: .id, .<slug>Id, .doc.<slug>Id, .xxxId, .doc.xxxId
extract_id(){
  local body="$1" key="${SLUG}Id"
  jq -er --arg k "$key" '
      .id
   // .[$k]
   // .doc[$k]
   // .xxxId
   // .doc.xxxId
   // empty' <<<"$body"
}

# --- State helpers -----------------------------------------------------------
save_last_id(){
  local id="$1"
  [ -n "$id" ] || { echo "save_last_id: empty id" >&2; return 1; }
  printf "%s" "$id" > "$STATE_ID_FILE"
  echo "state: saved id=$id → $STATE_ID_FILE" >&2
}
load_last_id(){ [ -f "$STATE_ID_FILE" ] && cat "$STATE_ID_FILE" || echo ""; }
require_last_id(){
  local id; id="$(load_last_id)"
  [ -n "$id" ] || { echo "ERROR: no saved id in $STATE_ID_FILE (run create test 002 first)" >&2; exit 2; }
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
  local j; j="$(load_create_payload)"
  [ -n "$j" ] || { echo "ERROR: no saved payload in $STATE_PAYLOAD_FILE (run create test 002 first)" >&2; exit 2; }
  printf "%s" "$j"
}

# --- Convenience -------------------------------------------------------------
svc_base_for_xxx(){
  local base="${SVCFAC_BASE_URL:-http://${HOST:-127.0.0.1}:${PORT:-4015}}"
  printf "%s/api/%s/v1" "$base" "${SLUG:-xxx}"
}
