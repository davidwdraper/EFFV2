#!/usr/bin/env bash
# backend/services/t_entity_crud/smokes/012-cursor-invalid.sh
# 012 — cursor invalid
# =============================================================================
# Expectation: reject bad base64-ish cursor with a 4xx problem+json OR a clear
# error code (INVALID_CURSOR/BAD_CURSOR). Bag-first + dtoType-aware routes.
#
# Params (env-override friendly):
#   SLUG=xxx HOST=127.0.0.1 PORT=4015 VERSION=1 TYPE=xxx
#   BASE (optional) or SVCFAC_BASE_URL (optional)
#
# macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

# --- Config ---------------------------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
# TYPE should follow DTO_TYPE, which itself defaults to SLUG
DTO_TYPE="${DTO_TYPE:-$SLUG}"
TYPE="${TYPE:-$DTO_TYPE}"

# Precedence: explicit BASE > SVCFAC_BASE_URL > http://HOST:PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

say(){ printf '%s\n' "$*" >&2; }

# deliberately garbage cursor
BAD="not-a-valid-base64-cursor"

URL="${BASE}/${TYPE}/list?limit=3&cursor=${BAD}"

say "→ GET  ${URL}"
RESP="$(curl -sS "${URL}")"

# Must be JSON (either problem+json or any JSON error envelope)
echo "${RESP}" | jq -e . >/dev/null || {
  say "ERROR: expected JSON body for invalid cursor response"; echo "${RESP}"; exit 1;
}

OK="$(echo "${RESP}" | jq -r '.ok // empty')"
STATUS="$(echo "${RESP}" | jq -r '.status // empty')"
CODE_UP="$(echo "${RESP}" | jq -r '.code // empty' | tr 'a-z' 'A-Z')"

if [ "${OK}" = "true" ]; then
  say "ERROR: expected failure for invalid cursor, got ok=true"
  exit 1
fi

# Accept: any 4xx status OR known codes (INVALID_CURSOR / BAD_CURSOR)
if { [ -n "${STATUS}" ] && echo "${STATUS}" | grep -Eq '^4[0-9][0-9]$'; } || \
   [ "${CODE_UP}" = "INVALID_CURSOR" ] || [ "${CODE_UP}" = "BAD_CURSOR" ]; then
  say "OK: invalid cursor correctly rejected with client error. (slug=${SLUG} type=${TYPE} port=${PORT})"
  exit 0
fi

say "ERROR: expected problem+json 4xx (or INVALID_CURSOR code); got:"
echo "${RESP}" | jq .
exit 1
