# backend/tests/smoke/tests/005-xxx-delete-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — delete by saved id (slug/port aware)
# Strategy:
#   1) Load the saved ID from state (written by test 002).
#   2) READ the record by that ID to confirm it exists and to discover the canonical DTO id.
#   3) DELETE using the canonical DTO id (never DB _id).
set -euo pipefail

# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../lib.sh"

# --- Config (env override friendly) ------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"

# Precedence: BASE (if provided) > SVCFAC_BASE_URL > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

say() { printf '%s\n' "$*" >&2; }

curl_json() {
  # usage: curl_json METHOD URL [DATA]
  # prints two blocks to stdout:
  #   HTTP <code>
  #   <body-json or raw body>
  local method="$1"; shift
  local url="$1"; shift
  local data="${1-}"

  if [ -n "$data" ]; then
    # shellcheck disable=SC2086
    resp="$(curl -sS -X "$method" -H 'content-type: application/json' \
      -w $'\nHTTP %{http_code}\n' \
      --data "$data" "$url")"
  else
    resp="$(curl -sS -X "$method" \
      -w $'\nHTTP %{http_code}\n' \
      "$url")"
  fi

  printf '%s' "$resp"
}

extract_http_code() {
  awk 'END{ if ($1=="HTTP") print $2; }'
}

extract_body() {
  # everything except the final "HTTP <code>" line
  awk 'NR==1, /HTTP [0-9]{3}$/ { if ($1=="HTTP" && NF==2 && $2 ~ /^[0-9]{3}$/) next; print }'
}

print_block() {
  # usage: print_block "→ GET <url>" "<HTTP nnn>" "<body>"
  local title="$1"
  local code="$2"
  local body="$3"
  say "$title"
  say "HTTP $code"
  if command -v jq >/dev/null 2>&1; then
    printf '%s\n' "$body" | jq . 2>/dev/null || printf '%s\n' "$body"
  else
    printf '%s\n' "$body"
  fi
}

# --- Load id from prior create ------------------------------------------------
SAVED_ID="$(require_last_id)"

# --- Step 1: READ (to confirm existence and normalize id) ---------------------
READ_URL="${BASE}/read/${SAVED_ID}"
read_raw="$(curl_json GET "$READ_URL")"
read_code="$(printf '%s\n' "$read_raw" | extract_http_code)"
read_body="$(printf '%s\n' "$read_raw" | extract_body)"

print_block "→ GET ${READ_URL}" "$read_code" "$read_body"

# Must be JSON
if ! printf '%s' "$read_body" | jq -e . >/dev/null 2>&1; then
  say "ERROR: read response is not valid JSON"
  exit 2
fi

# ok must be true; if not, bail with clear hint to rerun 002
ok="$(printf '%s' "$read_body" | jq -r '.ok // empty')"
if [ "$ok" != "true" ] || [ "$read_code" != "200" ]; then
  say "ERROR: read-by-saved-id not ok (HTTP=$read_code). Re-run test 002 to seed a fresh record."
  exit 2
fi

# Extract the canonical DTO id from the READ response:
# Prefer .id, then .doc.<slug>Id, then .<slug>Id; fall back to historical xxxId shapes; never DB _id.
CANON_ID="$(printf '%s' "$read_body" | jq -er \
  --arg k "${SLUG}Id" \
  '.id // .doc[$k] // .[$k] // .xxxId // .doc.xxxId // empty')"

if [ -z "${CANON_ID}" ]; then
  say "ERROR: could not determine canonical DTO id from read response (.id / .doc.${SLUG}Id / .${SLUG}Id / .xxxId)"
  exit 3
fi

# --- Step 2: DELETE using the canonical DTO id --------------------------------
DEL_URL="${BASE}/delete/${CANON_ID}"
del_raw="$(curl_json DELETE "$DEL_URL")"
del_code="$(printf '%s\n' "$del_raw" | extract_http_code)"
del_body="$(printf '%s\n' "$del_raw" | extract_body)"

print_block "→ DELETE ${DEL_URL}" "$del_code" "$del_body"

# Must be JSON
if ! printf '%s' "$del_body" | jq -e . >/dev/null 2>&1; then
  say "ERROR: delete response is not valid JSON"
  exit 4
fi

# ok must be true
if [ "$(printf '%s' "$del_body" | jq -r '.ok // empty')" != "true" ] || [ "$del_code" != "200" ]; then
  say "ERROR: delete not ok (HTTP=$del_code, tried canonical id: ${CANON_ID})"
  exit 4
fi

# deleted == 1 (accept number or string)
jq -e '(.deleted|tostring) == "1"' >/dev/null <<<"$del_body" || {
  say "ERROR: deleted != 1"
  exit 5
}

say "OK: deleted id=${CANON_ID} for ${SLUG}:${PORT}"
