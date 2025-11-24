# backend/tests/smoke/tests/003-svcconfig-s2s-route.sh
#!/usr/bin/env bash
# 003 - s2s-route (svcconfig: env/slug/majorVersion → S2S route lookup)
# Params (env override friendly):
#   SLUG, DTO_TYPE, HOST, PORT, VERSION, BASE, ENV_NAME,
#   TARGET_SLUG_BASE, TARGET_SLUG, TARGET_MAJOR_VERSION, TARGET_PORT
set -euo pipefail

# PORT must be provided by the runner (smoke.sh --port)
if [ -z "${PORT:-}" ]; then
  echo "ERROR: PORT is not set. Run this test via smoke.sh with --port <port>." >&2
  exit 2
fi

# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../../lib.sh"

# Unique suffix per test run (used to guarantee unique (env, slug, majorVersion))
SUF="$(date +%s)$$"

# --- Config ----------------------------------------------------------
SLUG="${SLUG:-svcconfig}"
DTO_TYPE="${DTO_TYPE:-$SLUG}"   # dtoType path segment; defaults to registry key (slug)
HOST="${HOST:-127.0.0.1}"
VERSION="${VERSION:-1}"

# Logical env for this record (matches EnvServiceDto env conceptually)
ENV_NAME="${ENV_NAME:-dev}"

# Base slug for the target service (for readability)
TARGET_SLUG_BASE="${TARGET_SLUG_BASE:-gateway-s2s-smoke}"

# Actual slug for this test run: ensure uniqueness by suffixing
TARGET_SLUG="${TARGET_SLUG:-${TARGET_SLUG_BASE}-${SUF}}"

# The major API version for the target service
TARGET_MAJOR_VERSION="${TARGET_MAJOR_VERSION:-1}"

# The target port the gateway (or caller) should proxy to
TARGET_PORT="${TARGET_PORT:-4015}"

# BASE: explicit override wins; otherwise compute directly from HOST/PORT.
# For this test we do NOT route via any facilitator base; we talk to svcconfig directly.
if [ -z "${BASE:-}" ]; then
  BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
fi

# Routed paths (CRUD create + s2s-route op)
#   PUT /api/<slug>/v<version>/:dtoType/create
#   GET /api/<slug>/v<version>/:dtoType/s2s-route?env=&slug=&majorVersion=
URL_CREATE="${BASE}/${DTO_TYPE}/create"
OP="${OP:-s2s-route}"
URL_S2S_ROUTE="${BASE}/${DTO_TYPE}/${OP}?env=${ENV_NAME}&slug=${TARGET_SLUG}&majorVersion=${TARGET_MAJOR_VERSION}"

# Optional delete op (assumes standard pattern)
#   DELETE /api/<slug>/v<version>/:dtoType/delete/:id
OP_DELETE="${OP_DELETE:-delete}"
URL_DELETE="${BASE}/${DTO_TYPE}/${OP_DELETE}"

# --- Helper: build payload for svcconfig.create ----------------------
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

echo "---- 010-svcconfig-s2s-route: create ----"
echo "PUT ${URL_CREATE}"
RESP="$(_put_json "${URL_CREATE}" "${BODY}")"

# Must be JSON
echo "${RESP}" | jq -e . >/dev/null

COUNT="$(echo "${RESP}" | jq -r '.items | length // 0')"
if [ "${COUNT}" -lt 1 ]; then
  echo "ERROR: svcconfig create for s2s-route test did not return any items"
  echo "${RESP}" | jq .
  exit 1
fi

# Capture ID for delete and debugging
ID="$(
  echo "${RESP}" | jq -er \
    --arg k "${DTO_TYPE}Id" \
    '.items[0][$k]
     // .items[0].id
     // .items[0]._id
     // empty' 2>/dev/null || echo ""
)"

if [ -z "${ID}" ]; then
  echo "WARN: svcconfig create did not expose an ID field in a known location; delete step will be best-effort only."
fi

echo "Created svcconfig entry:"
echo "${RESP}" | jq .

# --- Call s2s-route and validate response ----------------------------
echo "---- 010-svcconfig-s2s-route: lookup ----"
echo "GET ${URL_S2S_ROUTE}"

S2S_JSON="$(_get_json "${URL_S2S_ROUTE}")"

echo "${S2S_JSON}" | jq -e . >/dev/null

COUNT_S2S="$(echo "${S2S_JSON}" | jq -r '.items | length // 0')"
if [ "${COUNT_S2S}" -lt 1 ]; then
  echo "ERROR: s2s-route returned no items for env='${ENV_NAME}', slug='${TARGET_SLUG}', majorVersion=${TARGET_MAJOR_VERSION}"
  echo "${S2S_JSON}" | jq .
  exit 1
fi

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

# --- Delete created row (best effort, no _delete helper) -------------
if [ -n "${ID}" ]; then
  echo "---- 010-svcconfig-s2s-route: delete ----"
  URL_DELETE_ID="${URL_DELETE}/${ID}"
  echo "DELETE ${URL_DELETE_ID}"

  # Best-effort DELETE. We don't fail the test on cleanup issues.
  # If lib.sh defines $CURL, use it; otherwise fall back to plain curl.
  CURL_BIN="${CURL:-curl}"

  # -sS: silent but show errors; -X DELETE; no -f so we can inspect non-2xx.
  DEL_HTTP_CODE="$(
    "${CURL_BIN}" -sS -w "%{http_code}" -o /tmp/svcconfig_010_delete.out \
      -X DELETE \
      "${URL_DELETE_ID}" || true
  )"

  echo "Delete HTTP ${DEL_HTTP_CODE}"
  if [ "${DEL_HTTP_CODE}" -lt 200 ] || [ "${DEL_HTTP_CODE}" -ge 300 ]; then
    echo "WARN: delete of svcconfig test record failed with HTTP ${DEL_HTTP_CODE} (non-fatal for test success)."
    cat /tmp/svcconfig_010_delete.out || true
  fi
fi

exit 0
