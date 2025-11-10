# backend/tests/smoke/tests/002-xxx-create-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — create (saves DTO id + payload for subsequent tests)
# Parametrized: SLUG, DTO_TYPE, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE
set -euo pipefail

# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../lib.sh"

# --- Config (env override friendly) ------------------------------------------
SLUG="${SLUG:-xxx}"
DTO_TYPE="${DTO_TYPE:-$SLUG}"   # dtoType path segment; defaults to registry key (slug)
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

# New routed path includes dtoType
# Controller: PUT /api/<slug>/v<version>/:dtoType/create
URL="${BASE}/${DTO_TYPE}/create"

# Unique suffix for repeatable runs
SUF="$(date +%s)$$"

# --- Bag-only payload (ADR-0050) --------------------------------------------
# Edges are bag-only. Provide a single DTO item with the registry type key.
# NOTE: 'type' must match the DtoRegistry key for this DTO (usually the slug).
BODY="$(cat <<JSON
{
  "items": [
    {
      "type": "${DTO_TYPE}",
      "txtfield1": "alpha-${SUF}",
      "txtfield2": "bravo-${SUF}",
      "numfield1": 1,
      "numfield2": 2
    }
  ]
}
JSON
)"

# --- Create ------------------------------------------------------------------
RESP="$(_put_json "${URL}" "${BODY}")"

# Must be JSON
echo "${RESP}" | jq -e . >/dev/null

# ok must be true
[ "$(echo "${RESP}" | jq -r '.ok // empty')" = "true" ] || {
  echo "ERROR: create not ok"
  echo "${RESP}" | jq .
  exit 1
}

# --- Extract id (slug/dtoType-aware, with fallbacks) -------------------------
ID="$(echo "${RESP}" | jq -er \
      --arg k "${DTO_TYPE}Id" \
      '.id
       // .doc[$k]
       // .[$k]
       // .doc._id
       // ._id
       // .doc.xxxId
       // .xxxId
       // empty')"

[ -n "${ID}" ] || {
  echo "ERROR: no id in response (.id | .doc[\"${DTO_TYPE}Id\"] | .[\"${DTO_TYPE}Id\"] | .doc._id | ._id | .doc.xxxId | .xxxId)"
  echo "${RESP}" | jq .
  exit 1
}

# --- Persist state for later tests -------------------------------------------
save_last_id "${ID}"
save_create_payload "${BODY}"

echo "OK: created id=${ID} @ ${SLUG}:${PORT} dtoType=${DTO_TYPE}"
