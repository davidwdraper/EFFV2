# backend/services/t_entity_crud/smokes/003-xxx-create-duplicate-4015.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 003 — strict duplicate create
# First create uses an explicit id and must echo it back.
# Second create with the SAME id must return HTTP 409 (strict duplicate).
#
# Contract:
#   PUT /api/{slug}/v{version}/{type}/create
#     body: { items:[{ type, doc:{ id, ...fields } }] }
#     resp: { ok:true, id:"<echoed id>" }
#
# macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

say(){ printf '%s\n' "$*" >&2; }

# --- Config (env override friendly) ------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
# TYPE now tracks DTO_TYPE (which itself defaults to SLUG)
DTO_TYPE="${DTO_TYPE:-$SLUG}"
TYPE="${TYPE:-$DTO_TYPE}"

# Precedence: BASE (if provided) > SVCFAC_BASE_URL > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

CREATE_URL="${BASE}/${TYPE}/create"

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
FIXED_ID="$(gen_uuid4)"
SUF="$(date +%s)$$"

BODY_JSON() {
  cat <<JSON
{
  "items": [
    {
      "type": "${TYPE}",
      "doc": {
        "id": "${1}",
        "txtfield1": "dup-test-${SUF}",
        "txtfield2": "dup-test-${SUF}",
        "numfield1": 1,
        "numfield2": 2
      }
    }
  ]
}
JSON
}

# --- First create -------------------------------------------------------------
say "→ PUT  ${CREATE_URL} (first create, explicit id)"
RESP1="$(curl -sS -X PUT "${CREATE_URL}" -H "content-type: application/json" --data "$(BODY_JSON "${FIXED_ID}")")"
echo "${RESP1}" | jq -e . >/dev/null

echo "${RESP1}" | jq -e '.ok == true' >/dev/null
ID1="$(echo "${RESP1}" | jq -r '.id // empty')"
if [ -z "${ID1}" ] || [ "${ID1}" != "${FIXED_ID}" ]; then
  say "ERROR: first create id mismatch (resp:${ID1:-<none>} != expected:${FIXED_ID})"
  echo "${RESP1}" | jq .
  exit 1
fi
say "First create ok: id=${ID1}"

# --- Second create (must be 409 strict duplicate) ----------------------------
say "→ PUT  ${CREATE_URL} (second create, same id → expect 409)"
RESP2="$(curl -sS -w '\n%{http_code}' -X PUT "${CREATE_URL}" -H "content-type: application/json" --data "$(BODY_JSON "${FIXED_ID}")")"

# Split body and status (portable in macOS bash)
HTTP_BODY="$(printf '%s' "${RESP2}" | sed '$d')"
HTTP_CODE="$(printf '%s' "${RESP2}" | tail -n1)"

# Must be JSON body
echo "${HTTP_BODY}" | jq -e . >/dev/null || { say "ERROR: non-JSON second response"; echo "${HTTP_BODY}"; exit 1; }

if [ "${HTTP_CODE}" != "409" ]; then
  say "ERROR: expected HTTP 409 on duplicate; got ${HTTP_CODE}"
  echo "${HTTP_BODY}" | jq .
  exit 1
fi

say "OK: strict duplicate correctly rejected (409). (slug=${SLUG} type=${TYPE} port=${PORT})"
exit 0
