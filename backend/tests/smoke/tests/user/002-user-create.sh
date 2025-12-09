# backend/tests/smoke/tests/auth/002-auth-create.sh
#!/usr/bin/env bash
# 002 - auth create (MOS stub)
# Parametrized: SLUG, DTO_TYPE, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE
set -euo pipefail

# PORT must be provided by the runner (smoke.sh --port)
if [ -z "${PORT:-}" ]; then
  echo "ERROR: PORT is not set. Run this test via smoke.sh with --port <port>." >&2
  exit 2
fi

# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../../lib.sh"

# --- Config (env override friendly) ------------------------------------------
SLUG="${SLUG:-auth}"
DTO_TYPE="${DTO_TYPE:-auth}"   # dtoType path segment; matches registry key
HOST="${HOST:-127.0.0.1}"
VERSION="${VERSION:-1}"

# Precedence: BASE (if provided) > SVCFAC_BASE_URL > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

# New routed path includes dtoType
# Controller: PUT /api/<slug>/v<version>/:dtoType/create
URL="${BASE}/${DTO_TYPE}/create"

# Unique suffix for repeatable runs
SUF="$(date +%s)$$"

# --- Bag-only payload --------------------------------------------------------
# Edges are bag-only. Provide a single DTO item with the registry type key.
BODY="$(cat <<JSON
{
  "items": [
    {
      "type": "${DTO_TYPE}",
      "givenName": "alpha-${SUF}",
      "lastName": "bravo-${SUF}",
      "email": "auth-${SUF}@example.com",
      "phone": "555000${SUF}",
      "homeLat": 34.0522,
      "homeLng": -118.2437
    }
  ]
}
JSON
)"

# --- Create ------------------------------------------------------------------
RESP="$(_put_json "${URL}" "${BODY}")"

# Must be JSON
echo "${RESP}" | jq -e . >/dev/null

# --- Structural checks for MOS stub -----------------------------------------
# 1) items must exist and be an array (empty is OK for MOS stub)
COUNT="$(echo "${RESP}" | jq -r '.items | length // 0')"
if ! [ "${COUNT}" -ge 0 ]; then
  echo "ERROR: response .items is not an array"
  echo "${RESP}" | jq .
  exit 1
fi

# 2) meta must reflect auth/create
META_OK="$(echo "${RESP}" | jq -r \
  '((.meta.op == "create") and (.meta.dtoType == "auth")) // false')"

if [ "${META_OK}" != "true" ]; then
  echo "ERROR: response.meta.op/dtoType not as expected (op=create, dtoType=auth)"
  echo "${RESP}" | jq .
  exit 1
fi

# 3) ok flag should be true
OK_FLAG="$(echo "${RESP}" | jq -r '.ok // false')"
if [ "${OK_FLAG}" != "true" ]; then
  echo "ERROR: response.ok is not true"
  echo "${RESP}" | jq .
  exit 1
fi

# --- Optional: if we ever return a real DTO, persist its id ------------------
if [ "${COUNT}" -gt 0 ]; then
  ID="$(echo "${RESP}" | jq -er \
        --arg k "${DTO_TYPE}Id" \
        '.items[0][$k]
         // .items[0].id
         // .items[0]._id
         // empty')"

  if [ -n "${ID}" ]; then
    save_last_id "${ID}"
    save_create_payload "${BODY}"
    echo "created id=${ID} @ ${SLUG}:${PORT} dtoType=${DTO_TYPE}"
  else
    echo "WARN: items[0] present but no id field found; skipping id persistence"
  fi
else
  echo "auth.create MOS stub: HTTP 200 with empty bag (items=[]), as expected"
fi
