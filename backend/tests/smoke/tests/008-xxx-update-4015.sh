# backend/tests/smoke/tests/008-xxx-update-4015.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke 008 — update (create → patch → read verify → delete)
# Parametrized: SLUG, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE, DTO_TYPE
# Leaves no baggage in DB. macOS Bash 3.2 compatible.
# ============================================================================
set -euo pipefail

SMOKE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$SMOKE_DIR/lib.sh"

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

# 1) CREATE (bag-only) --------------------------------------------------------
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
CRESP="$(_put_json "${BASE}/${DTO_TYPE}/create" "${CREATE_BODY}")"
echo "${CRESP}" | jq -e . >/dev/null
OK="$(jq -er '.ok' <<<"${CRESP}")" || { echo "ERROR: create: non-JSON or missing .ok"; echo "${CRESP}"; exit 1; }
[ "${OK}" = "true" ] || { echo "ERROR: create failed"; echo "${CRESP}" | jq .; exit 1; }
ID="$(jq -r '.id // empty' <<<"${CRESP}")"
[ -n "${ID}" ] || { echo "ERROR: create: missing .id in response"; echo "${CRESP}" | jq .; exit 1; }

# 2) PATCH (bag-only; typed route) --------------------------------------------
PATCH_BODY="$(cat <<JSON
{
  "items": [
    {
      "type": "${DTO_TYPE}",
      "doc": {
        "id": "${ID}",
        "txtfield1": "u8-alpha-updated-${SUF}",
        "numfield2": 99
      }
    }
  ]
}
JSON
)"
URESP="$(curl -sS -X PATCH "${BASE}/${DTO_TYPE}/update/${ID}" \
  -H 'content-type: application/json' \
  -H 'x-request-id: smoke-008-patch' \
  -d "${PATCH_BODY}")"

echo "${URESP}" | jq -e . >/dev/null
UOK="$(jq -er '.ok' <<<"${URESP}")" || { echo "ERROR: update: non-JSON or missing .ok"; echo "${URESP}"; exit 1; }
[ "${UOK}" = "true" ] || { echo "ERROR: update failed"; echo "${URESP}" | jq .; exit 1; }
UPD_ID="$(jq -r '.id // empty' <<<"${URESP}")"
[ -n "${UPD_ID}" ] || { echo "ERROR: update: missing .id"; echo "${URESP}" | jq .; exit 1; }
[ "${UPD_ID}" = "${ID}" ] || { echo "ERROR: update id mismatch: got ${UPD_ID} expected ${ID}"; exit 1; }

# 2b) READ verify (bag-only; typed route) -------------------------------------
RRESP="$(_get_json "${BASE}/${DTO_TYPE}/read/${ID}")"
echo "${RRESP}" | jq -e . >/dev/null
ITEMS_LEN="$(jq -r '.items | length' <<<"${RRESP}")"
[ "${ITEMS_LEN}" = "1" ] || { echo "ERROR: read verify expected 1 item, got ${ITEMS_LEN}"; echo "${RRESP}" | jq .; exit 1; }
V_ID="$(jq -r '.items[0].id // empty' <<<"${RRESP}")"
[ "${V_ID}" = "${ID}" ] || { echo "ERROR: read verify id mismatch: ${V_ID} != ${ID}"; exit 1; }
V_TYPE="$(jq -r '.items[0].type // empty' <<<"${RRESP}")"
[ "${V_TYPE}" = "${DTO_TYPE}" ] || { echo "ERROR: read verify type mismatch: ${V_TYPE} != ${DTO_TYPE}"; exit 1; }
V_TXT="$(jq -r '.items[0].txtfield1 // empty' <<<"${RRESP}")"
V_NUM="$(jq -r '.items[0].numfield2 // empty' <<<"${RRESP}")"
[ "${V_TXT}" = "u8-alpha-updated-${SUF}" ] || { echo "ERROR: txtfield1 not updated: ${V_TXT}"; exit 1; }
[ "${V_NUM}" = "99" ] || { [ "${V_NUM}" = 99 ] || { echo "ERROR: numfield2 not updated: ${V_NUM}"; exit 1; }; }

# 3) DELETE (cleanup; typed route) --------------------------------------------
DRESP="$(_del_json "${BASE}/${DTO_TYPE}/delete/${ID}")"
echo "${DRESP}" | jq -e . >/dev/null
DOK="$(jq -er '.ok' <<<"${DRESP}")" || { echo "ERROR: delete: non-JSON or missing .ok"; echo "${DRESP}"; exit 1; }
[ "${DOK}" = "true" ] || { echo "ERROR: delete failed"; echo "${DRESP}" | jq .; exit 1; }
jq -e '(.deleted|tostring) == "1"' >/dev/null <<<"${DRESP}" || { echo "ERROR: delete: deleted != 1"; echo "${DRESP}" | jq .; exit 1; }

echo "OK: update verified and cleaned up for ${SLUG}:${PORT} (dtoType=${DTO_TYPE})"
