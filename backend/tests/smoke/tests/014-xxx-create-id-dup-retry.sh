# backend/tests/smoke/tests/014-xxx-create-id-dup-retry.sh
#!/usr/bin/env bash
# =============================================================================
# NowVibin Smoke — create with explicit id, then repeat to trigger _id duplicate
# Re-runnable + self-cleaning:
#   • Fresh FIXED_ID per run (explicit)
#   • If first create 409s due to residue, rotate ID once and retry
#   • Always DELETE created ids before exit (best-effort)
#
# Pass conditions:
#   • Retry mode: second create → 200 { ok:true, id:<new uuidv4> } != first id
#   • Strict mode: second create → HTTP 409 (or code:DUPLICATE/duplicate_key)
# =============================================================================
set -euo pipefail

# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../lib.sh"

log(){ printf '%s\n' "$*" >&2; }

# --- Config ------------------------------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
TYPE="${TYPE:-xxx}"

if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

CREATE_URL="${BASE}/${TYPE}/create"
DELETE_URL_BASE="${BASE}/${TYPE}/delete?id="

UUID4_RE='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

# --- UUID helper -------------------------------------------------------------
gen_uuid4() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-Z' 'a-z'
  elif [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  else
    python3 - <<'PY' 2>/dev/null | tr -d '\n' || { echo "ERROR: no UUID generator"; exit 2; }
import uuid; print(str(uuid.uuid4()))
PY
  fi
}

# Stable id for *this run* (explicit in payload). Allow override via env.
FIXED_ID="${FIXED_ID:-$(gen_uuid4)}"
SUF="$(date +%s)$$"

BODY_JSON() {
  cat <<JSON
{
  "items": [
    {
      "type": "${TYPE}",
      "doc": {
        "id": "${1}",
        "txtfield1": "alpha-${SUF}",
        "txtfield2": "bravo-${SUF}",
        "numfield1": 1,
        "numfield2": 2
      }
    }
  ]
}
JSON
}

# --- Cleanup (best-effort; never fails the test) -----------------------------
CREATED_ID1=""
CREATED_ID2=""

_cleanup() {
  for ID in "${CREATED_ID1:-}" "${CREATED_ID2:-}"; do
    [ -z "${ID}" ] && continue
    URL="${DELETE_URL_BASE}${ID}"
    log "→ DELETE ${URL}  (cleanup)"
    # best-effort: don't -e pipefail this curl; we want cleanup to continue
    RESP="$(curl -sS -X DELETE "${URL}" || true)"
    if echo "${RESP}" | jq -e '.ok == true' >/dev/null 2>&1; then
      log "cleanup ok: id=${ID}"
    else
      log "cleanup warn: could not confirm delete for id=${ID}"
      [ -n "${RESP}" ] && echo "${RESP}" | jq . >&2 || true
    fi
  done
}
trap _cleanup EXIT

# --- First create (rotate once on residue 409) --------------------------------
log "→ PUT ${CREATE_URL} (first create, explicit id=${FIXED_ID})"
RESP1="$(_put_json "${CREATE_URL}" "$(BODY_JSON "${FIXED_ID}")")"
echo "${RESP1}" | jq -e . >/dev/null

OK1="$(echo "${RESP1}" | jq -r '.ok // empty')"
ID1="$(echo "${RESP1}" | jq -r '.id // empty')"
STATUS1="$(echo "${RESP1}" | jq -r '(.status // empty) | tostring')"
CODE1="$(echo "${RESP1}" | jq -r '.code // empty' | tr 'A-Z' 'a-z')"

if [ "${OK1}" != "true" ]; then
  if [ "${STATUS1}" = "409" ] || [ "${CODE1}" = "duplicate" ] || [ "${CODE1}" = "duplicate_key" ]; then
    NEW_ID="$(gen_uuid4)"
    log "Residue detected on first create. Rotating FIXED_ID → ${NEW_ID} and retrying…"
    FIXED_ID="${NEW_ID}"
    RESP1="$(_put_json "${CREATE_URL}" "$(BODY_JSON "${FIXED_ID}")")"
    echo "${RESP1}" | jq -e . >/dev/null
    OK1="$(echo "${RESP1}" | jq -r '.ok // empty')"
    ID1="$(echo "${RESP1}" | jq -r '.id // empty')"
    [ "${OK1}" = "true" ] || { echo "ERROR: first create failed after id rotate"; echo "${RESP1}" | jq .; exit 1; }
  else
    echo "ERROR: first create failed"
    echo "${RESP1}" | jq .
    exit 1
  fi
fi

if [ "${ID1}" != "${FIXED_ID}" ]; then
  echo "ERROR: first create did not echo provided id (expected ${FIXED_ID}, got ${ID1})"
  echo "${RESP1}" | jq .
  exit 1
fi
CREATED_ID1="${ID1}"
log "First create ok: id=${ID1}"

# --- Second create (same id → retry or 409) ----------------------------------
log "→ PUT ${CREATE_URL} (second create, same id → retry or 409 expected)"
RESP2="$(_put_json "${CREATE_URL}" "$(BODY_JSON "${FIXED_ID}")")"
echo "${RESP2}" | jq -e . >/dev/null

OK2="$(echo "${RESP2}" | jq -r '.ok // empty')"
ID2="$(echo "${RESP2}" | jq -r '.id // empty')"
STATUS2="$(echo "${RESP2}" | jq -r '(.status // empty) | tostring')"
CODE2="$(echo "${RESP2}" | jq -r '.code // empty' | tr 'A-Z' 'a-z')"

# Retry mode PASS
if [ "${OK2}" = "true" ] && [ -n "${ID2}" ] && [ "${ID2}" != "${ID1}" ]; then
  LOWER_ID2="$(printf '%s' "${ID2}" | tr 'A-Z' 'a-z')"
  if printf '%s\n' "${LOWER_ID2}" | grep -Eq "${UUID4_RE}"; then
    CREATED_ID2="${ID2}"
    log "OK: retry mode — new id ${ID2} (original ${ID1})"
    exit 0
  else
    echo "ERROR: retry produced non-UUIDv4 id: ${ID2}"
    echo "${RESP2}" | jq .
    exit 1
  fi
fi

# Strict mode PASS
if [ "${STATUS2}" = "409" ] || [ "${CODE2}" = "duplicate" ] || [ "${CODE2}" = "duplicate_key" ]; then
  log "OK: strict mode — duplicate correctly rejected (409)"
  exit 0
fi

echo "ERROR: unexpected response (neither retry-success nor explicit 409 duplicate)"
echo "${RESP2}" | jq .
exit 1
