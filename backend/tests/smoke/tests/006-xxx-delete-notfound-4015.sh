# backend/services/t_entity_crud/smokes/006-xxx-delete-notfound-4015.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 006 — delete not found (STRICT)
# Flow:
#   1) Create a doc with explicit id
#   2) DELETE /{type}/delete/{id} → expect 200 { ok:true, deleted:1, id }
#   3) DELETE /{type}/delete/{id} again → expect 404 (NOT_FOUND)
#
# Notes:
# - Adds a tiny backoff on step 3 to tolerate async delete commit when run in --all.
# - dtoType in path; bag-first on create.
# - macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

say(){ printf '%s\n' "$*" >&2; }

# --- Config (env override friendly) ------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
# TYPE should follow DTO_TYPE, which itself defaults to SLUG
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
DELETE_URL_BASE="${BASE}/${TYPE}/delete"

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

BODY_JSON="$(cat <<JSON
{
  "items": [
    {
      "type": "${TYPE}",
      "doc": {
        "id": "${FIXED_ID}",
        "txtfield1": "delete-notfound-${SUF}",
        "txtfield2": "delete-notfound-${SUF}",
        "numfield1": 1,
        "numfield2": 2
      }
    }
  ]
}
JSON
)"

# --- Create ------------------------------------------------------------------
say "→ PUT  ${CREATE_URL} (seed explicit id=${FIXED_ID})"
RESP_CREATE="$(curl -sS -X PUT "${CREATE_URL}" -H "content-type: application/json" --data "${BODY_JSON}")"
echo "${RESP_CREATE}" | jq -e '.ok == true' >/dev/null
ECHO_ID="$(echo "${RESP_CREATE}" | jq -r '.id // empty')"
[ "${ECHO_ID}" = "${FIXED_ID}" ] || { say "ERROR: create did not echo id"; echo "${RESP_CREATE}" | jq .; exit 1; }

# --- First delete: must succeed ----------------------------------------------
DEL_URL="${DELETE_URL_BASE}/${FIXED_ID}"
say "→ DELETE ${DEL_URL} (first delete)"
RESP1="$(curl -sS -w '\n%{http_code}' -X DELETE "${DEL_URL}")"
BODY1="$(printf '%s' "${RESP1}" | sed '$d')"
CODE1="$(printf '%s' "${RESP1}" | tail -n1)"
echo "${BODY1}" | jq -e . >/dev/null

if [ "${CODE1}" != "200" ]; then
  say "ERROR: expected 200 on first delete; got ${CODE1}"
  echo "${BODY1}" | jq .
  exit 1
fi
echo "${BODY1}" | jq -e '.ok == true and .deleted == 1 and .id == "'"${FIXED_ID}"'"' >/dev/null || {
  say "ERROR: first delete body mismatch"
  echo "${BODY1}" | jq .
  exit 1
}

# --- Second delete: expect 404 (with short backoff retries) -------------------
attempt=0
max_attempts=3
sleep_ms=150

while :; do
  attempt=$((attempt + 1))
  say "→ DELETE ${DEL_URL} (second delete attempt ${attempt}/${max_attempts})"
  RESP2="$(curl -sS -w '\n%{http_code}' -X DELETE "${DEL_URL}")"
  BODY2="$(printf '%s' "${RESP2}" | sed '$d')"
  CODE2="$(printf '%s' "${RESP2}" | tail -n1)"

  # If 404, we're done.
  if [ "${CODE2}" = "404" ]; then
    say "OK: second delete returned 404 (not found). (slug=${SLUG} type=${TYPE} port=${PORT})"
    exit 0
  fi

  # If still 200 deleted:1, likely async commit; back off briefly then retry.
  if [ "${CODE2}" = "200" ] && echo "${BODY2}" | jq -e '.deleted == 1' >/dev/null 2>&1; then
    if [ "${attempt}" -lt "${max_attempts}" ]; then
      # portable tiny sleep (~0.15s) for macOS bash
      perl -e 'select(undef,undef,undef,0.15);' 2>/dev/null || sleep 1
      continue
    fi
  fi

  say "ERROR: expected 404 on second delete; got ${CODE2}"
  echo "${BODY2}" | jq .
  exit 1
done
