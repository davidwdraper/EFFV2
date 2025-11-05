# backend/tests/smoke/tests/003-xxx-create-duplicate-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — create duplicate (NO new seed; uses payload from 002)
# Expect: 409 Conflict (duplicate). DB unchanged.
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

# Template service mounts create at the base path (PUT /)
URL="${BASE}/"

# --- Require the original create happened (from test 002) --------------------
# Saved by 002; already bag-only with items[0].type="${SLUG}"
BODY="$(require_create_payload)"

# --- Attempt the duplicate create -------------------------------------------
RESP="$(_put_json "${URL}" "${BODY}")"
echo "${RESP}" | jq -e . >/dev/null

# Normalize
STATUS="$(echo "${RESP}" | jq -r 'if has("status") then (.status|tostring) else empty end')"
CODE="$(echo "${RESP}" | jq -r '.code // empty' | tr 'A-Z' 'a-z')"

if [ "${STATUS}" != "409" ] && [ "${CODE}" != "duplicate" ] && [ "${CODE}" != "duplicate_key" ]; then
  echo "ERROR: expected 409 duplicate; got:"
  echo "${RESP}" | jq .
  exit 1
fi

echo "OK: duplicate correctly returned conflict for ${SLUG}:${PORT}"
