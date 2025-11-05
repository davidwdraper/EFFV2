# backend/tests/smoke/tests/014-xxx-create-id-dup-retry.sh
#!/usr/bin/env bash
# NowVibin Smoke — create with explicit id, then repeat to trigger _id duplicate
# Goal: Exercise DbWriter's 3-attempt retry-on-_id-collision logic.
# Expected:
#   - First create: 200 { ok:true, id:"<fixed-id>" }
#   - Second create with SAME id: writer retries and succeeds → 200 with DIFFERENT id
#
# If policy is strict (409 on _id dup, no retry), this test will fail by design.

set -euo pipefail

# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../lib.sh"

log() { printf '%s\n' "$*" >&2; }

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

URL="${BASE}/"

# Stable id so the second insert collides on _id
FIXED_ID="00000000-0000-4000-8000-000000000001"
SUF="$(date +%s)$$"

# Bag-only payload (ADR-0050): items[] + meta.limit=1
BODY="$(cat <<JSON
{
  "items": [
    {
      "type": "xxx",
      "id": "${FIXED_ID}",
      "txtfield1": "alpha-${SUF}",
      "txtfield2": "bravo-${SUF}",
      "numfield1": 1,
      "numfield2": 2
    }
  ],
  "meta": { "limit": 1 }
}
JSON
)"

log "→ PUT ${URL} (first create, explicit id)"
RESP1="$(_put_json "${URL}" "${BODY}")"
echo "${RESP1}" | jq -e . >/dev/null

OK1="$(echo "${RESP1}" | jq -r '.ok // empty')"
ID1="$(echo "${RESP1}" | jq -r '.id // .doc.id // empty')"

if [ "${OK1}" != "true" ] || [ -z "${ID1}" ]; then
  echo "ERROR: first create failed or missing id"
  echo "${RESP1}" | jq .
  exit 1
fi

log "First create ok: id=${ID1}"

log "→ PUT ${URL} (second create, same id → expect writer retry & new id)"
RESP2="$(_put_json "${URL}" "${BODY}")"
echo "${RESP2}" | jq -e . >/dev/null

OK2="$(echo "${RESP2}" | jq -r '.ok // empty')"
ID2="$(echo "${RESP2}" | jq -r '.id // .doc.id // empty')"
STATUS2="$(echo "${RESP2}" | jq -r '(.status // empty) | tostring')"
CODE2="$(echo "${RESP2}" | jq -r '.code // empty' | tr 'A-Z' 'a-z')"

# Accepted PASS case: retry logic produced a different id and ok:true
if [ "${OK2}" = "true" ] && [ -n "${ID2}" ] && [ "${ID2}" != "${ID1}" ]; then
  log "OK: retry succeeded with new id ${ID2} (original ${ID1})"
  exit 0
fi

# If the service is strict and returns 409 duplicate, call it out explicitly.
if [ "${STATUS2}" = "409" ] || [ "${CODE2}" = "duplicate" ] || [ "${CODE2}" = "duplicate_key" ]; then
  echo "ERROR: service returned strict 409 on _id duplicate (no retry)."
  echo "If intentional, remove/skip 014. Otherwise enable _id retry in DbWriter."
  echo "${RESP2}" | jq .
  exit 1
fi

echo "ERROR: unexpected response (neither retry-success nor explicit 409 duplicate)"
echo "${RESP2}" | jq .
exit 1
