# backend/tests/smoke/tests/010-svcconfig-s2s-route.sh
#!/usr/bin/env bash
# 010 - s2s-route (svcconfig: env/slug/majorVersion → S2S route lookup)
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
SLUG="${SLUG:-svcconfig}"
DTO_TYPE="${DTO_TYPE:-$SLUG}"   # dtoType path segment; defaults to registry key (slug)
HOST="${HOST:-127.0.0.1}"
VERSION="${VERSION:-1}"

# Logical env for this record (matches EnvServiceDto env)
ENV_NAME="${ENV_NAME:-dev}"

# Target service we’re configuring (dedicated test slug to avoid conflicts with 002)
TARGET_SLUG="${TARGET_SLUG:-gateway-s2s-smoke}"

# The major API version for the target service
TARGET_MAJOR_VERSION="${TARGET_MAJOR_VERSION:-1}"

# The target port the gateway (or caller) should proxy to
TARGET_PORT="${TARGET_PORT:-4015}"

# Precedence: BASE (if provided) > SVCFAC_BASE_URL > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

# Routed paths (CRUD create + s2s-route op)
#   PUT /api/<slug>/v<version>/:dtoType/create
#   GET /api/<slug>/v<version>/:dtoType/s2s-route?env=&slug=&majorVersion=
URL_CREATE="${BASE}/${DTO_TYPE}/create"
OP="${OP:-s2s-route}"
URL_S2S_ROUTE="${BASE}/${DTO_TYPE}/${OP}?env=${ENV_NAME}&slug=${TARGET_SLUG}&majorVersion=${TARGET_MAJOR_VERSION}"

# Unique suffix for notes/labels only (not part of uniqueness key)
SUF="$(date +%s)$$"

# --- Helper: build payload for svcconfig.create ------------------------------
build_body() {
  cat <<JSON
{
  "items": [
    {
      "type": "${DTO_TYPE}",
      "env": "${ENV_NAME}",
      "slug": "${TARGET_SLUG}",
      "majorVersion": ${TARGET_MAJOR_VERSION},
      "targetPort": ${TARGET_PORT},
      "disabled": false,
      "minUserType": 0,
      "labels": ["smoke", "auto"],
      "notes": "svcconfig-010-s2s-route-${SUF}"
    }
  ]
}
JSON
}

BODY="$(build_body)"

# --- Create svcconfig row ----------------------------------------------------
RESP="$(_put_json "${URL_CREATE}" "${BODY}")"

# Must be JSON
echo "${RESP}" | jq -e . >/dev/null

COUNT="$(echo "${RESP}" | jq -r '.items | length // 0')"
[ "${COUNT}" -ge 1 ] || {
  echo "ERROR: svcconfig create for s2s-route test did not return any items"
  echo "${RESP}" | jq .
  exit 1
}

# Optional: capture ID for debugging (not used further yet)
ID="$(
  echo "${RESP}" | jq -er \
    --arg k "${DTO_TYPE}Id" \
    '.items[0][$k]
     // .items[0].id
     // .items[0]._id
     // empty' 2>/dev/null || echo ""
)"

# --- Call s2s-route and validate response ------------------------------------
S2S_JSON="$(_get_json "${URL_S2S_ROUTE}")"

echo "${S2S_JSON}" | jq -e . >/dev/null

COUNT_S2S="$(echo "${S2S_JSON}" | jq -r '.items | length // 0')"
[ "${COUNT_S2S}" -ge 1 ] || {
  echo "ERROR: s2s-route returned no items for env='${ENV_NAME}', slug='${TARGET_SLUG}', majorVersion=${TARGET_MAJOR_VERSION}"
  echo "${S2S_JSON}" | jq .
  exit 1
}

ENV_OUT="$(echo "${S2S_JSON}" | jq -r '.items[0].env // empty')"
SLUG_OUT="$(echo "${S2S_JSON}" | jq -r '.items[0].slug // empty')"
MAJOR_OUT="$(echo "${S2S_JSON}" | jq -r '.items[0].majorVersion // 0')"
PORT_OUT="$(echo "${S2S_JSON}" | jq -r '.items[0].targetPort // 0')"

if [ "${ENV_OUT}" != "${ENV_NAME}" ]; then
  echo "ERROR: s2s-route env mismatch: got env='${ENV_OUT}', expected '${ENV_NAME}'"
  echo "${S2S_JSON}" | jq .
  exit 1
fi

if [ "${SLUG_OUT}" != "${TARGET_SLUG}" ]; then
  echo "ERROR: s2s-route slug mismatch: got slug='${SLUG_OUT}', expected '${TARGET_SLUG}'"
  echo "${S2S_JSON}" | jq .
  exit 1
fi

if [ "${MAJOR_OUT}" -ne "${TARGET_MAJOR_VERSION}" ]; then
  echo "ERROR: s2s-route majorVersion mismatch: got ${MAJOR_OUT}, expected ${TARGET_MAJOR_VERSION}"
  echo "${S2S_JSON}" | jq .
  exit 1
fi

if [ "${PORT_OUT}" -ne "${TARGET_PORT}" ]; then
  echo "ERROR: s2s-route targetPort mismatch: got ${PORT_OUT}, expected ${TARGET_PORT}"
  echo "${S2S_JSON}" | jq .
  exit 1
fi

echo "svcconfig s2s-route OK (create + read): env='${ENV_NAME}', slug='${TARGET_SLUG}', majorVersion=${TARGET_MAJOR_VERSION}, targetPort=${TARGET_PORT}"
exit 0
