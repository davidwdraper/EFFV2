#!/usr/bin/env bash
# backend/tests/smoke/tests/014-xxx-create-id-dup-retry.sh
# 014 - _id duplicate triggers retry → two inserts
# =============================================================================
# Requirements:
#   • First create MUST return bagged success: { ok:true, items:[{ _id, type, ... }] }
#   • Second create MUST use the SAME _id but DIFFERENT business fields
#     so the business unique index does NOT fire; only _id duplicate does.
#   • Backend MUST retry by cloning with a NEW UUIDv4 → insert succeeds.
#   • We MUST end with TWO records (original _id and retried _id).
#
# macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../../lib.sh"

say(){ printf '%s\n' "$*" >&2; }
die(){ say "ERROR: $*"; exit 1; }

# --- Config ------------------------------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4016}"
VERSION="${VERSION:-1}"
DTO_TYPE="${DTO_TYPE:-$SLUG}"
TYPE="${TYPE:-$DTO_TYPE}"

if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

CREATE_URL="${BASE}/${TYPE}/create"
# New canonical path-style endpoints:
READ_URL_FOR_ID(){ printf "%s/%s/read/%s" "$BASE" "$TYPE" "$1"; }
DELETE_URL_FOR_ID(){ printf "%s/%s/delete/%s" "$BASE" "$TYPE" "$1"; }

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

# Fixed primary key for both creates (forces _id duplicate)
FIXED_ID="${FIXED_ID:-$(gen_uuid4)}"
# Different business fields across attempts (avoid business unique)
S1="$(date +%s%N | cut -b1-12)"
S2="$(date +%s%N | cut -b13-24)"

BODY_JSON_ATTEMPT_1() {
  cat <<JSON
{
  "items": [
    {
      "type": "${TYPE}",
      "doc": {
        "_id": "${FIXED_ID}",
        "txtfield1": "alpha-${S1}",
        "txtfield2": "bravo-${S1}",
        "numfield1": 1,
        "numfield2": 2
      }
    }
  ]
}
JSON
}

BODY_JSON_ATTEMPT_2() {
  cat <<JSON
{
  "items": [
    {
      "type": "${TYPE}",
      "doc": {
        "_id": "${FIXED_ID}",
        "txtfield1": "alpha-${S2}",
        "txtfield2": "charlie-${S2}",
        "numfield1": 11,
        "numfield2": 22
      }
    }
  ]
}
JSON
}

# --- Cleanup (best-effort) ---------------------------------------------------
CREATED_ID1=""
CREATED_ID2=""

_cleanup() {
  for ID in "${CREATED_ID1:-}" "${CREATED_ID2:-}"; do
    [ -z "${ID}" ] && continue
    URL="$(DELETE_URL_FOR_ID "${ID}")"
    say "→ DELETE ${URL}  (cleanup)"
    # Canonical DELETE with path param
    HTTP="$(curl -sS -o /tmp/_nv_del_resp.json -w "%{http_code}" -X DELETE "${URL}" || true)"
    RESP="$(cat /tmp/_nv_del_resp.json || true)"
    if [ "$HTTP" = "200" ] && echo "${RESP}" | jq -e '.ok == true' >/dev/null 2>&1; then
      say "cleanup ok: id=${ID}"
    else
      say "cleanup warn: HTTP ${HTTP} for id=${ID}"
      [ -n "${RESP}" ] && echo "${RESP}" | jq . >&2 || true
    fi
    rm -f /tmp/_nv_del_resp.json
  done
}
trap _cleanup EXIT

say "→ PUT ${CREATE_URL} (first create, explicit id=${FIXED_ID}, biz=S1)"
RESP1="$(_put_json "${CREATE_URL}" "$(BODY_JSON_ATTEMPT_1)")" || die "first create HTTP error"
echo "${RESP1}" | jq -e . >/dev/null || { echo "${RESP1}"; die "first create returned non-JSON"; }

# Enforce bagged success shape
OK1="$(echo "${RESP1}" | jq -r '.ok // empty')"
HAS_ITEMS1="$(echo "${RESP1}" | jq -r 'has("items")')"
[ "${OK1}" = "true" ] || { echo "${RESP1}" | jq .; die "expected ok:true on first create"; }
[ "${HAS_ITEMS1}" = "true" ] || { echo "${RESP1}" | jq .; die "response must be bagged: missing 'items'"; }
LEN1="$(echo "${RESP1}" | jq -r '.items | length')"
[ "${LEN1}" = "1" ] || { echo "${RESP1}" | jq .; die "bagged response must contain exactly one item"; }

ID1="$(echo "${RESP1}" | jq -r '.items[0]._id // empty')"
TYPE1="$(echo "${RESP1}" | jq -r '.items[0].type // empty')"
[ -n "${ID1}" ] || { echo "${RESP1}" | jq .; die "bagged dto missing .items[0]._id"; }
[ "${TYPE1}" = "${TYPE}" ] || { echo "${RESP1}" | jq .; die "bagged dto .items[0].type must equal '${TYPE}'"; }
[ "${ID1}" = "${FIXED_ID}" ] || { echo "${RESP1}" | jq .; die "first create did not echo provided _id"; }
CREATED_ID1="${ID1}"
say "First create ok (bagged): _id=${ID1}"

# Second create: SAME _id, DIFFERENT business fields → must hit _id duplicate,
# backend should retry and return NEW _id (bagged)
say "→ PUT ${CREATE_URL} (second create, SAME id=${FIXED_ID}, biz=S2 → expect retry→new id)"
RESP2="$(_put_json "${CREATE_URL}" "$(BODY_JSON_ATTEMPT_2)")" || true
echo "${RESP2}" | jq -e . >/dev/null || { echo "${RESP2}" | jq .; die "second create returned non-JSON"; }

OK2="$(echo "${RESP2}" | jq -r '.ok // empty')"
HAS_ITEMS2="$(echo "${RESP2}" | jq -r 'has("items")')"
[ "${OK2}" = "true" ] || { echo "${RESP2}" | jq .; die "expected ok:true on second create (retry mode only)"; }
[ "${HAS_ITEMS2}" = "true" ] || { echo "${RESP2}" | jq .; die "retry response must be bagged"; }
LEN2="$(echo "${RESP2}" | jq -r '.items | length')"
[ "${LEN2}" = "1" ] || { echo "${RESP2}" | jq .; die "retry response must contain exactly one item"; }

ID2="$(echo "${RESP2}" | jq -r '.items[0]._id // empty')"
[ -n "${ID2}" ] || { echo "${RESP2}" | jq .; die "retry response missing items[0]._id"; }
[ "${ID2}" != "${ID1}" ] || { echo "${RESP2}" | jq .; die "retry did not change _id"; }
LOWER_ID2="$(printf '%s' "${ID2}" | tr 'A-Z' 'a-z')"
printf '%s\n' "${LOWER_ID2}" | grep -Eq "${UUID4_RE}" || { echo "${RESP2}" | jq .; die "retry produced non-UUIDv4 _id"; }
CREATED_ID2="${ID2}"
say "Retry mode ok — new _id ${ID2} (original ${ID1})"

# Verify BOTH documents exist (two inserts) — canonical read path
READ1="$(curl -sS "$(READ_URL_FOR_ID "${ID1}")")" || die "read1 HTTP error"
READ2="$(curl -sS "$(READ_URL_FOR_ID "${ID2}")")" || die "read2 HTTP error"
echo "${READ1}" | jq -e '.items[0]._id == "'${ID1}'"' >/dev/null 2>&1 || { echo "${READ1}" | jq .; die "read1 did not return _id=${ID1}"; }
echo "${READ2}" | jq -e '.items[0]._id == "'${ID2}'"' >/dev/null 2>&1 || { echo "${READ2}" | jq .; die "read2 did not return _id=${ID2}"; }

say "OK: _id duplicate retried → two inserts (ids: ${ID1}, ${ID2})"
exit 0
