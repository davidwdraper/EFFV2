# backend/tests/smoke/tests/002-xxx-create-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — create (saves DTO id + payload for subsequent tests)
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

URL="${BASE}/create"
SUF="$(date +%s)$$"

# Single payload used for ALL subsequent tests (dup/read/delete/notfound)
BODY="$(cat <<JSON
{"txtfield1":"alpha-${SUF}","txtfield2":"bravo-${SUF}","numfield1":1,"numfield2":2}
JSON
)"

# --- Create -------------------------------------------------------------------
RESP="$(_put_json "${URL}" "${BODY}")"

# Must be JSON
echo "${RESP}" | jq -e . >/dev/null

# ok must be true
[ "$(echo "${RESP}" | jq -r '.ok // empty')" = "true" ] || {
  echo "ERROR: create not ok"
  echo "${RESP}" | jq .
  exit 1
}

# --- Extract id (slug-aware, with fallbacks) ----------------------------------
ID="$(echo "${RESP}" | jq -er \
      --arg k "${SLUG}Id" \
      '.id
       // .doc[$k]
       // .[$k]
       // .doc._id
       // ._id
       // .doc.xxxId
       // .xxxId
       // empty')"

[ -n "${ID}" ] || {
  echo "ERROR: no id in response (.id | .doc[\"${SLUG}Id\"] | .[\"${SLUG}Id\"] | .doc._id | ._id | .doc.xxxId | .xxxId)"
  echo "${RESP}" | jq .
  exit 1
}

# --- Persist state for later tests -------------------------------------------
save_last_id "${ID}"
save_create_payload "${BODY}"

echo "OK: created id=${ID} @ ${SLUG}:${PORT}"
