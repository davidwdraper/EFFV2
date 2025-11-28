#!/usr/bin/env bash
# backend/tests/smoke/tests/xxx/008-xxx-update.sh
# 008 — update (create → patch → read verify → delete)
# ============================================================================
# Parametrized: SLUG, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE, DTO_TYPE
# Leaves no baggage in DB. macOS Bash 3.2 compatible.
#
# Rules (post _id refactor):
#   - DTOs use _id only; no id, no ${slug}Id, no idFieldName.
#   - _id is minted by the service and passed through to Mongo unchanged.
#   - CREATE returns: { ok:true, items:[{ _id, ... }] }.
#   - All subsequent operations use that _id.
#   - DELETE success is bag-only with an empty items array.
# ============================================================================

set -euo pipefail

# --- tiny local helpers (no lib.sh) ------------------------------------------
_need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing dependency: $1" >&2; exit 97; }; }
_need curl; _need jq

_put_json() {
  # _put_json URL BODY
  curl -fsS -X PUT "$1" \
    -H 'content-type: application/json' \
    --data "$2"
}

_get_json() {
  # _get_json URL
  curl -fsS -X GET "$1"
}

_del_json() {
  # _del_json URL
  curl -fsS -X DELETE "$1"
}

# --- Config -------------------------------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
DTO_TYPE="${DTO_TYPE:-xxx}"

if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

SUF="${RANDOM}"

# 1) CREATE (bag-only, service mints _id) --------------------------------------
CREATE_BODY="$(cat <<JSON
{
  "items": [
    {
      "type": "${DTO_TYPE}",
      "doc": {
        "txtfield1": "u8-alpha-${SUF}",
        "txtfield2": "u8-bravo-${SUF}",
        "numfield1": 8,
        "numfield2": 88
      }
    }
  ]
}
JSON
)"

echo "→ PUT  ${BASE}/${DTO_TYPE}/create"
CRESP="$(_put_json "${BASE}/${DTO_TYPE}/create" "${CREATE_BODY}")"
echo "${CRESP}" | jq -e . >/dev/null

OK="$(jq -er '.ok' <<<"${CRESP}")" || { echo "ERROR: create: non-JSON or missing .ok"; echo "${CRESP}"; exit 1; }
[ "${OK}" = "true" ] || { echo "ERROR: create failed"; echo "${CRESP}" | jq .; exit 1; }

ITEMS_LEN="$(jq -r '.items | length' <<<"${CRESP}")"
[ "${ITEMS_LEN}" = "1" ] || { echo "ERROR: create: expected 1 item, got ${ITEMS_LEN}"; echo "${CRESP}" | jq .; exit 1; }

ID="$(jq -r '.items[0]._id // empty' <<<"${CRESP}")"
[ -n "${ID}" ] || { echo "ERROR: create: missing items[0]._id in response"; echo "${CRESP}" | jq .; exit 1; }

echo "seeded _id=${ID}"

# 2) PATCH (bag-only; typed route, _id is canonical) ---------------------------
PATCH_BODY="$(cat <<JSON
{
  "items": [
    {
      "type": "${DTO_TYPE}",
      "doc": {
        "_id": "${ID}",
        "txtfield1": "u8-alpha-updated-${SUF}",
        "numfield2": 99
      }
    }
  ]
}
JSON
)"

echo "→ PATCH ${BASE}/${DTO_TYPE}/update/${ID}"
URESP="$(curl -sS -X PATCH "${BASE}/${DTO_TYPE}/update/${ID}" \
  -H 'content-type: application/json' \
  -H 'x-request-id: smoke-008-patch' \
  -d "${PATCH_BODY}")"

echo "${URESP}" | jq -e . >/dev/null
UOK="$(jq -er '.ok' <<<"${URESP}")" || { echo "ERROR: update: non-JSON or missing .ok"; echo "${URESP}"; exit 1; }
[ "${UOK}" = "true" ] || { echo "ERROR: update failed"; echo "${URESP}" | jq .; exit 1; }

# If update returns a bag, sanity-check _id matches; otherwise skip quietly.
U_HAS_ITEMS="$(jq -r 'has("items")' <<<"${URESP}")" || U_HAS_ITEMS="false"
if [ "${U_HAS_ITEMS}" = "true" ]; then
  U_ITEMS_LEN="$(jq -r '.items | length' <<<"${URESP}")"
  if [ "${U_ITEMS_LEN}" != "0" ]; then
    UPD_ID="$(jq -r '.items[0]._id // empty' <<<"${URESP}")"
    [ -z "${UPD_ID}" ] || [ "${UPD_ID}" = "${ID}" ] || {
      echo "ERROR: update: _id mismatch in response: got ${UPD_ID}, expected ${ID}"
      echo "${URESP}" | jq .
      exit 1
    }
  fi
fi

# 2b) READ verify (bag-only; typed route, _id-only) ---------------------------
echo "→ GET  ${BASE}/${DTO_TYPE}/read/${ID}"
RRESP="$(_get_json "${BASE}/${DTO_TYPE}/read/${ID}")"
echo "${RRESP}" | jq -e . >/dev/null

ITEMS_LEN="$(jq -r '.items | length' <<<"${RRESP}")"
[ "${ITEMS_LEN}" = "1" ] || { echo "ERROR: read verify expected 1 item, got ${ITEMS_LEN}"; echo "${RRESP}" | jq .; exit 1; }

V_ID="$(jq -r '.items[0]._id // empty' <<<"${RRESP}")"
[ "${V_ID}" = "${ID}" ] || { echo "ERROR: read verify _id mismatch: ${V_ID} != ${ID}"; exit 1; }

V_TYPE="$(jq -r '.items[0].type // empty' <<<"${RRESP}")"
[ "${V_TYPE}" = "${DTO_TYPE}" ] || { echo "ERROR: read verify type mismatch: ${V_TYPE} != ${DTO_TYPE}"; exit 1; }

V_TXT="$(jq -r '.items[0].txtfield1 // empty' <<<"${RRESP}")"
V_NUM="$(jq -r '.items[0].numfield2 // empty' <<<"${RRESP}")"
[ "${V_TXT}" = "u8-alpha-updated-${SUF}" ] || { echo "ERROR: txtfield1 not updated: ${V_TXT}"; exit 1; }
[ "${V_NUM}" = "99" ] || { [ "${V_NUM}" = 99 ] || { echo "ERROR: numfield2 not updated: ${V_NUM}"; exit 1; }; }

# 3) DELETE (cleanup; typed route, _id-only, bag-only success) -----------------
echo "→ DELETE ${BASE}/${DTO_TYPE}/delete/${ID}"
DRESP="$(_del_json "${BASE}/${DTO_TYPE}/delete/${ID}")"
echo "${DRESP}" | jq -e . >/dev/null

DOK="$(jq -er '.ok' <<<"${DRESP}")" || { echo "ERROR: delete: non-JSON or missing .ok"; echo "${DRESP}"; exit 1; }
[ "${DOK}" = "true" ] || { echo "ERROR: delete failed"; echo "${DRESP}" | jq .; exit 1; }

D_ITEMS_LEN="$(jq -r '.items | length' <<<"${DRESP}")"
[ "${D_ITEMS_LEN}" = "0" ] || {
  echo "ERROR: delete: expected 0 items in bag, got ${D_ITEMS_LEN}"
  echo "${DRESP}" | jq .
  exit 1
}

D_OP="$(jq -r '.meta.op // empty' <<<"${DRESP}")"
[ "${D_OP}" = "delete" ] || {
  echo "ERROR: delete: expected meta.op=delete, got ${D_OP}"
  echo "${DRESP}" | jq .
  exit 1
}

D_COUNT="$(jq -r '.meta.count // empty' <<<"${DRESP}")"
[ "${D_COUNT}" = "0" ] || [ "${D_COUNT}" = 0 ] || {
  echo "ERROR: delete: expected meta.count=0, got ${D_COUNT}"
  echo "${DRESP}" | jq .
  exit 1
}

echo "update verified and cleaned up for ${SLUG}:${PORT} (dtoType=${DTO_TYPE}, _id=${ID})"
