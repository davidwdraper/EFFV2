# backend/tests/smoke/tests/007-xxx-read-notfound-4015.sh
#!/usr/bin/env bash
# =============================================================================
# NowVibin Smoke — read notfound (STRICT, self-contained)
# Flow:
#   1) CREATE with explicit id
#   2) DELETE same id → expect 200 { ok:true, deleted:1 }
#   3) READ same id   → expect 404 (NOT_FOUND)
#
# No dependency on prior tests. macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

say(){ printf '%s\n' "$*" >&2; }

# --- Config (env override friendly) ------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
DTO_TYPE="${DTO_TYPE:-xxx}"

# Precedence: BASE (if provided) > SVCFAC_BASE_URL > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

CREATE_URL="${BASE}/${DTO_TYPE}/create"
DELETE_URL_BASE="${BASE}/${DTO_TYPE}/delete"
READ_URL_BASE="${BASE}/${DTO_TYPE}/read"

# --- UUIDv4 (portable) -------------------------------------------------------
gen_uuid4() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-Z' 'a-z'
  elif [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  else
    python3 - <<'PY' 2>/dev/null | tr -d '\n' || { echo "ERROR: need uuidgen or python3"; exit 2; }
import uuid; print(str(uuid.uuid4()))
PY
  fi
}

ID="$(gen_uuid4)"
SUF="$(date +%s)$$"

BODY_JSON="$(cat <<JSON
{
  "items": [
    {
      "type": "${DTO_TYPE}",
      "doc": {
        "id": "${ID}",
        "txtfield1": "read-notfound-${SUF}",
        "txtfield2": "read-notfound-${SUF}",
        "numfield1": 1,
        "numfield2": 2
      }
    }
  ]
}
JSON
)"

# --- 1) CREATE ---------------------------------------------------------------
say "→ PUT  ${CREATE_URL} (seed explicit id=${ID})"
RESP_CREATE="$(curl -sS -X PUT "${CREATE_URL}" -H "content-type: application/json" --data "${BODY_JSON}")"
echo "${RESP_CREATE}" | jq -e '.ok == true' >/dev/null
ECHO_ID="$(echo "${RESP_CREATE}" | jq -r '.id // empty')"
[ "${ECHO_ID}" = "${ID}" ] || { say "ERROR: create did not echo id"; echo "${RESP_CREATE}" | jq .; exit 1; }

# --- 2) DELETE ---------------------------------------------------------------
DEL_URL="${DELETE_URL_BASE}/${ID}"
say "→ DELETE ${DEL_URL} (delete seeded doc)"
RESP_DEL="$(curl -sS -w '\n%{http_code}' -X DELETE "${DEL_URL}")"
BODY_DEL="$(printf '%s' "${RESP_DEL}" | sed '$d')"
CODE_DEL="$(printf '%s' "${RESP_DEL}" | tail -n1)"
echo "${BODY_DEL}" | jq -e . >/dev/null

if [ "${CODE_DEL}" != "200" ]; then
  say "ERROR: expected 200 on delete; got ${CODE_DEL}"
  echo "${BODY_DEL}" | jq .
  exit 1
fi
echo "${BODY_DEL}" | jq -e '.ok == true and .deleted == 1 and .id == "'"${ID}"'"' >/dev/null || {
  say "ERROR: delete body mismatch"
  echo "${BODY_DEL}" | jq .
  exit 1
}

# --- tiny backoff before read (durability) -----------------------------------
perl -e 'select(undef,undef,undef,0.15);' 2>/dev/null || sleep 1

# --- 3) READ (expect 404 NOT_FOUND) ------------------------------------------
READ_URL="${READ_URL_BASE}/${ID}"
say "→ GET  ${READ_URL} (expect 404 NOT_FOUND)"
RESP_READ="$(curl -sS "${READ_URL}")"

# Must be JSON
echo "${RESP_READ}" | jq -e . >/dev/null 2>&1 || {
  echo "ERROR: read-notfound response is not valid JSON"
  echo "${RESP_READ}"
  exit 1
}

STATUS="$(echo "${RESP_READ}" | jq -r '.status // empty')"
CODE="$(echo "${RESP_READ}" | jq -r '.code // empty' | tr 'a-z' 'A-Z')"

if [ "${STATUS}" != "404" ] && [ "${CODE}" != "NOT_FOUND" ]; then
  echo "ERROR: expected 404 NOT_FOUND on read of deleted id=${ID}"
  echo "${RESP_READ}" | jq .
  exit 1
fi

echo "OK: read-notfound confirmed for id=${ID} (${SLUG}:${PORT}, dtoType=${DTO_TYPE})"
