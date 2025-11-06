# backend/tests/smoke/tests/003-xxx-create-duplicate-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — create duplicate (independent test)
# Purpose:
#   1) Generate a valid 24-hex ObjectId string
#   2) Create a record with that id
#   3) Attempt to create the SAME record again
# Expect:
#   1st PUT → 200/201 OK with created id
#   2nd PUT → 409 Conflict (duplicate key)
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

# Route shape requires dtoType in the path
URL_CREATE="${BASE}/${SLUG}/create"

# --- Helpers -----------------------------------------------------------------
gen_objectid () {
  # Prefer openssl; fallback to /dev/urandom + hexdump
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 12
  else
    # POSIX-ish fallback: 12 bytes (24 hex chars)
    dd if=/dev/urandom bs=12 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n'
  fi
}

mk_body () {
  local OID="$1"
  # Bag-only wire envelope (ADR-0050); dtoType matches :dtoType
  cat <<JSON
{
  "items": [
    {
      "type": "${SLUG}",
      "item": {
        "id": "${OID}",
        "type": "${SLUG}",
        "txtfield1": "dup-probe",
        "txtfield2": "dup-probe",
        "numfield1": 1,
        "numfield2": 2
      }
    }
  ]
}
JSON
}

# --- 1) Create with fixed ObjectId -------------------------------------------
OID="$(gen_objectid)"
BODY1="$(mk_body "${OID}")"

RESP1="$(_put_json "${URL_CREATE}" "${BODY1}")"
echo "${RESP1}" | jq -e . >/dev/null

STATUS1="$(echo "${RESP1}" | jq -r '.status // empty')"
CREATED_ID="$(echo "${RESP1}" | jq -r '.id // .created?.id // empty')"

if [ -z "${CREATED_ID}" ] || ! printf '%s' "${CREATED_ID}" | grep -Eq '^[0-9a-fA-F]{24}$'; then
  echo "ERROR: could not locate created id in first response"
  echo "Response was:"
  echo "${RESP1}" | jq .
  exit 1
fi

if [ -n "${STATUS1}" ] && [ "${STATUS1}" != "200" ] && [ "${STATUS1}" != "201" ]; then
  echo "ERROR: unexpected status on first create: ${STATUS1}"
  echo "${RESP1}" | jq .
  exit 1
fi

echo "OK: first create accepted with id=${CREATED_ID}"

# --- 2) Attempt duplicate with the SAME id -----------------------------------
BODY2="$(mk_body "${OID}")"
RESP2="$(_put_json "${URL_CREATE}" "${BODY2}")"
echo "${RESP2}" | jq -e . >/dev/null

STATUS2="$(echo "${RESP2}" | jq -r '.status // empty')"
CODE2="$(echo "${RESP2}" | jq -r '.code // empty' | tr 'A-Z' 'a-z')"

if [ "${STATUS2}" != "409" ] && [ "${CODE2}" != "duplicate" ] && [ "${CODE2}" != "duplicate_key" ]; then
  echo "ERROR: expected 409 duplicate; got:"
  echo "${RESP2}" | jq .
  exit 1
fi

echo "OK: duplicate correctly returned conflict for ${SLUG}:${PORT}"
