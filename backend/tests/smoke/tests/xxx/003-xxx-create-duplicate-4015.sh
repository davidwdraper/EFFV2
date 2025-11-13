# backend/services/t_entity_crud/smokes/003-xxx-create-duplicate-4015.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 003 — duplicate-by-content (business fields)
#
# SYSTEM RULES (CURRENT):
#  - Success response MUST be bagged:
#        { ok:true, items:[ { _id, type, ... } ] }
#    where `_id` is the external/wire primary key.
#  - Second create with SAME business content but DIFFERENT _id MUST 409 with
#    Problem+JSON and code "DUPLICATE_CONTENT".
#
# macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

say(){ printf '%s\n' "$*" >&2; }
die(){ say "ERROR: $*"; exit 1; }

SLUG="${SLUG:-xxx}"
TYPE="${DTO_TYPE:-$SLUG}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4016}"
BASE="http://${HOST}:${PORT}/api/${SLUG}/v1/${TYPE}"

# --- payload seed ------------------------------------------------------------
STAMP="dup-test-$(date +%s%N | cut -b1-15)"
ID1="${ID1:-$(uuidgen | tr 'A-Z' 'a-z')}"
ID2="${ID2:-$(uuidgen | tr 'A-Z' 'a-z')}" # different _id

PAYLOAD1=$(cat <<JSON
{
  "items": [
    {
      "type": "${TYPE}",
      "doc": {
        "_id": "${ID1}",
        "txtfield1": "${STAMP}",
        "txtfield2": "${STAMP}",
        "numfield1": 1,
        "numfield2": 2
      }
    }
  ]
}
JSON
)

PAYLOAD2=$(cat <<JSON
{
  "items": [
    {
      "type": "${TYPE}",
      "doc": {
        "_id": "${ID2}",
        "txtfield1": "${STAMP}",
        "txtfield2": "${STAMP}",
        "numfield1": 1,
        "numfield2": 2
      }
    }
  ]
}
JSON
)

say "TEST: 003-xxx-create-duplicate-4015.sh  (SLUG=${SLUG} DTO_TYPE=${TYPE} PORT=${PORT} HOST=${HOST})"
say "=============================================================================="

# --- First create: must be bagged -------------------------------------------
say "→ PUT ${BASE}/create (first create, explicit _id=${ID1})"
RESP1=$(curl -sS -X PUT -H 'content-type: application/json' --data-binary "${PAYLOAD1}" "${BASE}/create" -w '\n%{http_code}')
BODY1="${RESP1%$'\n'*}"
CODE1="${RESP1##*$'\n'}"

[ -n "${CODE1}" ] || die "could not determine HTTP code for first create"
[ "${CODE1}" = "200" ] || { say "${BODY1}"; die "first create expected 200"; }

OK=$(printf '%s' "${BODY1}" | jq -r '.ok // false')
[ "${OK}" = "true" ] || { say "${BODY1}"; die "expected ok:true"; }

# Hard fail if legacy flat shape is returned
HAS_ITEMS=$(printf '%s' "${BODY1}" | jq -r 'has("items")')
[ "${HAS_ITEMS}" = "true" ] || { say "${BODY1}"; die "response must be bagged: missing 'items'"; }

ITEMS_LEN=$(printf '%s' "${BODY1}" | jq -r '.items | length')
[ "${ITEMS_LEN}" = "1" ] || { say "${BODY1}"; die "response must contain exactly one item in 'items'"; }

ID_ECHO=$(printf '%s' "${BODY1}" | jq -r '.items[0]._id // empty')
[ -n "${ID_ECHO}" ] || { say "${BODY1}"; die "bagged dto missing .items[0]._id"; }

TYPE_ECHO=$(printf '%s' "${BODY1}" | jq -r '.items[0].type // empty')
[ "${TYPE_ECHO}" = "${TYPE}" ] || { say "${BODY1}"; die "bagged dto .items[0].type must equal '${TYPE}'"; }

say "First create ok: bagged _id=${ID_ECHO}"

# --- Second create: expect 409 DUPLICATE_CONTENT ----------------------------
say "→ PUT ${BASE}/create (second create, SAME content, different _id=${ID2} → expect 409 DUPLICATE_CONTENT)"
RESP2=$(curl -sS -X PUT -H 'content-type: application/json' --data-binary "${PAYLOAD2}" "${BASE}/create" -w '\n%{http_code}')
BODY2="${RESP2%$'\n'*}"
CODE2="${RESP2##*$'\n'}"

[ -n "${CODE2}" ] || { say "${BODY2}"; die "could not determine HTTP code for second create"; }
[ "${CODE2}" = "409" ] || { say "${BODY2}"; die "expected 409 on duplicate-by-content"; }

ERR_TITLE=$(printf '%s' "${BODY2}" | jq -r '.title // empty')
[ "${ERR_TITLE}" = "Conflict" ] || { say "${BODY2}"; die "Problem+JSON title must be 'Conflict'"; }

ERR_CODE=$(printf '%s' "${BODY2}" | jq -r '.code // empty')
[ "${ERR_CODE}" = "DUPLICATE_CONTENT" ] || { say "${BODY2}"; die "expected error code 'DUPLICATE_CONTENT'"; }

say "✅ PASS: duplicate-by-content correctly returned 409 (DUPLICATE_CONTENT) with bagged success response"
