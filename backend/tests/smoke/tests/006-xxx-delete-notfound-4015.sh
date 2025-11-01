# backend/tests/smoke/tests/006-xxx-delete-notfound-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — delete notfound (re-delete the same saved id after a successful delete)
# Parametrized: SLUG, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE
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

# --- Use the same id saved by test 002 (and deleted by test 005) -------------
ID="$(require_last_id)"
URL="${BASE}/delete/${ID}"

# --- Attempt re-delete; expect NOT_FOUND -------------------------------------
RESP="$(_del_json "${URL}")"
echo "${RESP}" | jq -e . >/dev/null

STATUS="$(echo "${RESP}" | jq -r '.status // empty')"
CODE="$(echo "${RESP}" | jq -r '.code // empty')"
CODE_UP="$(printf "%s" "${CODE}" | tr 'a-z' 'A-Z')"

if [ "${STATUS}" != "404" ] && [ "${STATUS}" != "404 Not Found" ] && [ "${CODE_UP}" != "NOT_FOUND" ]; then
  echo "ERROR: expected 404 NOT_FOUND on second delete of id=${ID}"
  echo "${RESP}" | jq .
  exit 1
fi

echo "OK: delete-notfound confirmed for id=${ID} (${SLUG}:${PORT})"
