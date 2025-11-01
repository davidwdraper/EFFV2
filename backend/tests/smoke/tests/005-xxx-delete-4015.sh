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

# --- Load id from prior create ------------------------------------------------
SAVED_ID="$(require_last_id)"

# --- Step 1: READ (to confirm existence and normalize id) ---------------------
READ_URL="${BASE}/read/${SAVED_ID}"
READ_JSON="$(_get_json "${READ_URL}")"

# Must be JSON
echo "${READ_JSON}" | jq -e . >/dev/null

# ok must be true; if not, bail with clear hint to rerun 002
if [ "$(echo "${READ_JSON}" | jq -r '.ok // empty')" != "true" ]; then
  echo "ERROR: read-by-saved-id not ok (state may be stale). Re-run test 002 to seed a fresh record." >&2
  echo "${READ_JSON}" | jq .
  exit 2
fi

# Extract the canonical DTO id from the READ response:
# Prefer .id, then .doc.<slug>Id, then .<slug>Id; fall back to historical xxxId shapes; never DB _id.
CANON_ID="$(echo "${READ_JSON}" | jq -er \
  --arg k "${SLUG}Id" \
  '.id // .doc[$k] // .[$k] // .xxxId // .doc.xxxId // empty')"

if [ -z "${CANON_ID}" ]; then
  echo "ERROR: could not determine canonical DTO id from read response (.id / .doc.${SLUG}Id / .${SLUG}Id / .xxxId)" >&2
  echo "${READ_JSON}" | jq .
  exit 3
fi

# --- Step 2: DELETE using the canonical DTO id --------------------------------
DEL_URL="${BASE}/delete/${CANON_ID}"
RESP="$(_del_json "${DEL_URL}")"

# Must be JSON
echo "${RESP}" | jq -e . >/dev/null

# ok must be true
if [ "$(echo "${RESP}" | jq -r '.ok // empty')" != "true" ]; then
  echo "ERROR: delete not ok (tried canonical id: ${CANON_ID})" >&2
  echo "${RESP}" | jq .
  exit 4
fi

# deleted == 1 (accept number or string)
jq -e '(.deleted|tostring) == "1"' >/dev/null <<<"${RESP}" || {
  echo "ERROR: deleted != 1" >&2
  echo "${RESP}" | jq .
  exit 5
}

echo "OK: deleted id=${CANON_ID} for ${SLUG}:${PORT}"
