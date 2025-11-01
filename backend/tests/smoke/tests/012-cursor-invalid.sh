# backend/services/t_entity_crud/smokes/012-cursor-invalid.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 012 — cursor invalid (rejects bad base64 cursor with 4xx problem+json)
# Parametrized: SLUG, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE
# macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

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

say(){ printf '%s\n' "$*" >&2; }

BAD="not-a-valid-base64-cursor"
URL="${BASE}/list?limit=3&cursor=${BAD}"

say "→ GET  ${URL}"
RESP="$(curl -sS "${URL}")"

# Must be JSON (problem+json or normal JSON)
echo "${RESP}" | jq -e . >/dev/null || {
  say "ERROR: expected JSON body for invalid cursor response"; echo "${RESP}"; exit 1;
}

STATUS="$(echo "${RESP}" | jq -r '.status // empty')"
OK="$(echo "${RESP}" | jq -r '.ok // empty')"
CODE_UP="$(echo "${RESP}" | jq -r '.code // empty' | tr 'a-z' 'A-Z')"

if [ "${OK}" = "true" ]; then
  say "ERROR: expected failure for invalid cursor, got ok=true"
  exit 1
fi

# Accept any 4xx OR a specific problem code like INVALID_CURSOR/BAD_CURSOR
if { [ -n "${STATUS}" ] && echo "${STATUS}" | grep -Eq '^4[0-9][0-9]$'; } || \
   [ "${CODE_UP}" = "INVALID_CURSOR" ] || [ "${CODE_UP}" = "BAD_CURSOR" ]; then
  say "OK: invalid cursor correctly rejected with client error. (slug=${SLUG} port=${PORT})"
  exit 0
fi

say "ERROR: expected problem+json 4xx (or INVALID_CURSOR code); got:"
echo "${RESP}" | jq .
exit 1
