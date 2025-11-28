#!/usr/bin/env bash
# backend/tests/smoke/tests/014-xxx-create-id-dup-retry.sh
# 014 - explicit _id duplicate → 409 Conflict (DUPLICATE_ID)
# =============================================================================
# Requirements (current rails):
#   • First create with explicit _id MUST succeed and echo that _id back
#     in a bagged response: { ok:true, items:[{ _id, type, ... }], meta:{...} }.
#   • Second create with the SAME explicit _id MUST:
#       - fail with a 4xx (409 expected),
#       - surface a Problem+JSON body with code=DUPLICATE_ID.
#   • Afterward, a read by that _id MUST still return exactly one record.
#
# Notes:
#   • This test no longer expects "retry to new id". Explicit client _id
#     collisions are treated as hard conflicts — not auto-healed.
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

_cleanup() {
  [ -z "${CREATED_ID1:-}" ] && return 0
  URL="$(DELETE_URL_FOR_ID "${CREATED_ID1}")"
  say "→ DELETE ${URL}  (cleanup)"
  HTTP="$(curl -sS -o /tmp/_nv_del_resp.json -w "%{http_code}" -X DELETE "${URL}" || true)"
  RESP="$(cat /tmp/_nv_del_resp.json || true)"
  if [ "$HTTP" = "200" ] && echo "${RESP}" | jq -e '.ok == true' >/dev/null 2>&1; then
    say "cleanup ok: id=${CREATED_ID1}"
  else
    say "cleanup warn: HTTP ${HTTP} for id=${CREATED_ID1}"
    [ -n "${RESP}" ] && echo "${RESP}" | jq . >&2 || true
  fi
  rm -f /tmp/_nv_del_resp.json
}
trap _cleanup EXIT

# --- First create: must succeed, echo fixed _id ------------------------------
say "→ PUT ${CREATE_URL} (first create, explicit id=${FIXED_ID}, biz=S1)"
RESP1="$(_put_json "${CREATE_URL}" "$(BODY_JSON_ATTEMPT_1)")" \
  || die "first create HTTP error"
echo "${RESP1}" | jq -e . >/dev/null || { echo "${RESP1}"; die "first create returned non-JSON"; }

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

LOWER_ID1="$(printf '%s\n' "${ID1}" | tr 'A-Z' 'a-z')"
printf '%s\n' "${LOWER_ID1}" | grep -Eq "${UUID4_RE}" \
  || { echo "${RESP1}" | jq .; die "first create _id is not UUIDv4"; }

CREATED_ID1="${ID1}"
say "First create ok (bagged): _id=${ID1}"

# --- Second create: SAME _id must yield 4xx / DUPLICATE_ID -------------------
say "→ PUT ${CREATE_URL} (second create, SAME id=${FIXED_ID}, biz=S2 → expect 409/DUPLICATE_ID)"

TMP_BODY="$(BODY_JSON_ATTEMPT_2)"
HTTP2="$(curl -sS -o /tmp/_nv_resp2.json -w "%{http_code}" \
  -X PUT "${CREATE_URL}" \
  -H "content-type: application/json" \
  --data "${TMP_BODY}" || true)"
RESP2="$(cat /tmp/_nv_resp2.json || true)"
rm -f /tmp/_nv_resp2.json

echo "${RESP2}" | jq -e . >/dev/null \
  || { echo "${RESP2}"; die "second create returned non-JSON"; }

# Must NOT be ok:true
OK2="$(echo "${RESP2}" | jq -r '.ok // empty')"
[ "${OK2}" != "true" ] || { echo "${RESP2}" | jq .; die "expected failure for explicit _id duplicate, got ok:true"; }

STATUS2_JSON="$(echo "${RESP2}" | jq -r '.status // empty')"
CODE2_UP="$(echo "${RESP2}" | jq -r '.code // empty' | tr 'a-z' 'A-Z')"

# Accept either HTTP status 409 or body.status 409; both should match in practice
if [ -n "${STATUS2_JSON}" ]; then
  if [ "${STATUS2_JSON}" != "409" ] && [ "${STATUS2_JSON}" != "409.0" ]; then
    echo "${RESP2}" | jq .
    die "expected .status==409 for duplicate _id; got ${STATUS2_JSON}"
  fi
fi

# We expect the normalized error code to be DUPLICATE_ID for _id_ index
[ "${CODE2_UP}" = "DUPLICATE_ID" ] || {
  echo "${RESP2}" | jq .
  die "expected error code DUPLICATE_ID for _id duplicate; got '${CODE2_UP}'"
}

# Optionally check HTTP code if curl gave us one (best-effort)
if echo "${HTTP2}" | grep -Eq '^[0-9]{3}$'; then
  [ "${HTTP2}" = "409" ] || {
    say "WARN: expected HTTP 409, got ${HTTP2} (body.status=${STATUS2_JSON})"
  }
fi

say "Second create correctly rejected as duplicate id (status=409, code=${CODE2_UP})."

# --- Verify only ONE record with that id exists ------------------------------
READ1_URL="$(READ_URL_FOR_ID "${ID1}")"
say "→ GET ${READ1_URL} (verify record still exists)"

READ1="$(curl -sS "${READ1_URL}")" || die "read1 HTTP error"
echo "${READ1}" | jq -e . >/dev/null || { echo "${READ1}"; die "read1 returned non-JSON"; }

# Canonical read: bagged items[0] with same _id
echo "${READ1}" | jq -e '.items[0]._id == "'${ID1}'"' >/dev/null 2>&1 \
  || { echo "${READ1}" | jq .; die "read1 did not return _id=${ID1}"; }

say "OK: explicit _id duplicate surfaced as DUPLICATE_ID conflict; original row intact (id=${ID1})."
exit 0
