#!/usr/bin/env bash
# backend/tests/smoke/tests/002-svcconfig-create.sh
# 002 - create (svcconfig: env/slug/majorVersion → targetPort mapping)
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

# Target service we’re configuring (gateway by default)
TARGET_SLUG="${TARGET_SLUG:-gateway}"

# The major API version for the target service
TARGET_MAJOR_VERSION="${TARGET_MAJOR_VERSION:-1}"

# The target port the gateway should proxy to (this svcconfig service itself is on $PORT)
TARGET_PORT="${TARGET_PORT:-4015}"

# Precedence: BASE (if provided) > SVCFAC_BASE_URL > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

# Routed paths (CRUD rails)
#   PUT    /api/<slug>/v<version>/:dtoType/create
#   GET    /api/<slug>/v<version>/:dtoType/list
#   DELETE /api/<slug>/v<version>/:dtoType/delete/:id
URL_CREATE="${BASE}/${DTO_TYPE}/create"
URL_LIST="${BASE}/${DTO_TYPE}/list"
URL_DELETE_BASE="${BASE}/${DTO_TYPE}/delete"

# Unique suffix for notes/labels only (not part of uniqueness key)
SUF="$(date +%s)$$"

# --- Helper: build payload ---------------------------------------------------
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
      "notes": "svcconfig-002-${SUF}"
    }
  ]
}
JSON
}

BODY="$(build_body)"

# --- First create attempt ----------------------------------------------------
RESP="$(_put_json "${URL_CREATE}" "${BODY}")"

# Must be JSON
echo "${RESP}" | jq -e . >/dev/null

CODE="$(echo "${RESP}" | jq -r '.code // empty')"
COUNT="$(echo "${RESP}" | jq -r '.items | length // 0')"

if [ "${COUNT}" -ge 1 ]; then
  # Happy path: insert succeeded on first try.
  ID="$(echo "${RESP}" | jq -er \
        --arg k "${DTO_TYPE}Id" \
        '.items[0][$k]
         // .items[0].id
         // .items[0]._id
         // empty')"

  [ -n "${ID}" ] || {
    echo "ERROR: insert succeeded but no id in response (.items[0][\"${DTO_TYPE}Id\"] | .items[0].id | .items[0]._id)"
    echo "${RESP}" | jq .
    exit 1
  }

  save_last_id "${ID}"
  save_create_payload "${BODY}"
  echo "created id=${ID} @ ${SLUG}:${PORT} dtoType=${DTO_TYPE} env=${ENV_NAME} target=${TARGET_SLUG}:${TARGET_PORT} v${TARGET_MAJOR_VERSION}"
  exit 0
fi

# --- Duplicate path: delete existing row and re-insert -----------------------
if [ "${CODE}" = "DUPLICATE_KEY" ]; then
  # Find the existing svcconfig row matching (env, slug, majorVersion)
  LIST_JSON="$(_get_json "${URL_LIST}")"

  # Support both legacy .docs[] and new .items[]
  EXISTING_ID="$(
    echo "${LIST_JSON}" \
    | jq -er \
        --arg env "${ENV_NAME}" \
        --arg slug "${TARGET_SLUG}" \
        --argjson major "${TARGET_MAJOR_VERSION}" '
          (
            .items // .docs // []
          )
          | .[]
          | select(.env == $env and .slug == $slug and .majorVersion == $major)
          | .id // ._id // empty
        ' 2>/dev/null || true
  )"

  if [ -z "${EXISTING_ID}" ]; then
    echo "ERROR: DUPLICATE_KEY reported, but no existing svcconfig row found for env='${ENV_NAME}', slug='${TARGET_SLUG}', majorVersion=${TARGET_MAJOR_VERSION}."
    echo "List response:"
    echo "${LIST_JSON}" | jq .
    exit 1
  fi

  # Delete the existing row
  URL_DELETE="${URL_DELETE_BASE}/${EXISTING_ID}"
  DEL_RESP="$(_delete_json "${URL_DELETE}")" || {
    echo "ERROR: failed to delete existing svcconfig id='${EXISTING_ID}'"
    echo "${DEL_RESP:-<no body>}" | jq . 2>/dev/null || true
    exit 1
  }

  # Try the create again with the same logical key
  RESP2="$(_put_json "${URL_CREATE}" "${BODY}")"

  echo "${RESP2}" | jq -e . >/dev/null

  COUNT2="$(echo "${RESP2}" | jq -r '.items | length // 0')"
  [ "${COUNT2}" -ge 1 ] || {
    echo "ERROR: second create after delete did not return any items"
    echo "${RESP2}" | jq .
    exit 1
  }

  ID2="$(echo "${RESP2}" | jq -er \
        --arg k "${DTO_TYPE}Id" \
        '.items[0][$k]
         // .items[0].id
         // .items[0]._id
         // empty')"

  [ -n "${ID2}" ] || {
    echo "ERROR: second create after delete returned no id (.items[0][\"${DTO_TYPE}Id\"] | .items[0].id | .items[0]._id)"
    echo "${RESP2}" | jq .
    exit 1
  }

  save_last_id "${ID2}"
  save_create_payload "${BODY}"
  echo "recreated id=${ID2} after deleting duplicate @ ${SLUG}:${PORT} dtoType=${DTO_TYPE} env=${ENV_NAME} target=${TARGET_SLUG}:${TARGET_PORT} v${TARGET_MAJOR_VERSION}"
  exit 0
fi

# --- Any other error is a hard failure ---------------------------------------
echo "ERROR: svcconfig create failed (no items and no DUPLICATE_KEY)"
echo "${RESP}" | jq .
exit 1
