#!/usr/bin/env bash
# backend/services/t_entity_crud/smokes/006-xxx-delete-notfound.sh
# 006 — delete not found
# =============================================================================
# Flow (bag-only + not-found contract):
#   1) CREATE a doc with no id fields; service mints _id.
#   2) DELETE /{type}/delete/{_id} → expect 200 with:
#        { ok:true, items:[], meta:{ op:"delete", dtoType?, count:0 } }
#   3) DELETE /{type}/delete/{_id} again → expect 404 (Not Found) Problem+JSON.
#
# Rules:
#   - DTOs use _id only; no external id, no idFieldName, no ${slug}Id.
#   - _id is minted inside the app and passed through to Mongo unchanged.
#   - Client uses the _id returned in items[0]._id as the canonical id.
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

# --- Run marker (for payload differentiation) --------------------------------
SUF="$(date +%s)$$"

# --- Create body: no id; service mints _id -----------------------------------
CREATE_BODY="$(jq -n --arg type "${TYPE}" --arg suf "${SUF}" '
  {
    items: [
      {
        type: $type,
        doc: {
          txtfield1: ("delete-notfound-" + $suf),
          txtfield2: ("delete-notfound-" + $suf),
          numfield1: 1,
          numfield2: 2
        }
      }
    ]
  }
')"

# --- Create ------------------------------------------------------------------
say "→ PUT  ${CREATE_URL} (seed new dto; service mints _id)"
RESP_CREATE="$(curl -sS -X PUT "${CREATE_URL}" -H "content-type: application/json" --data "${CREATE_BODY}")"
echo "${RESP_CREATE}" | jq . >&2 || true

# Validate create contract: ok + single item + _id present
echo "${RESP_CREATE}" | jq -e '.ok == true' >/dev/null || {
  say "ERROR: create.ok != true"
  exit 1
}

ITEM_COUNT="$(echo "${RESP_CREATE}" | jq -r '.items | length')"
[ "${ITEM_COUNT}" -eq 1 ] || {
  say "ERROR: expected exactly 1 item, got ${ITEM_COUNT}"
  exit 1
}

CREATED_ID="$(echo "${RESP_CREATE}" | jq -r '.items[0]._id // empty')"
[ -n "${CREATED_ID}" ] || {
  say "ERROR: create missing items[0]._id"
  exit 1
}

say "created _id=${CREATED_ID}"

# Helper: assert bag-only delete response for the first delete
check_delete_body() {
  local body="$1"

  echo "${body}" | jq -e '.ok == true' >/dev/null || {
    say "ERROR: delete.ok != true"
    return 1
  }

  local items_count
  items_count="$(echo "${body}" | jq -r '.items | length')"
  [ "${items_count}" -eq 0 ] || {
    say "ERROR: delete expected items:[] (count=0), got ${items_count}"
    return 1
  }

  local op
  op="$(echo "${body}" | jq -r '.meta.op // empty')"
  [ "${op}" = "delete" ] || {
    say "ERROR: delete meta.op != \"delete\" (got \"${op}\")"
    return 1
  }

  # dtoType is optional but, if present, must match TYPE/DTO_TYPE
  local dtoType
  dtoType="$(echo "${body}" | jq -r '.meta.dtoType // empty')"
  if [ -n "${dtoType}" ] && [ "${dtoType}" != "${TYPE}" ]; then
    say "ERROR: delete meta.dtoType mismatch (got \"${dtoType}\")"
    return 1
  fi

  return 0
}

# --- First delete: must succeed with bag-only response -----------------------
DEL_URL="${DELETE_URL_BASE}/${CREATED_ID}"
say "→ DELETE ${DEL_URL} (first delete)"
RESP1="$(curl -sS -w '\n%{http_code}' -X DELETE "${DEL_URL}")"
BODY1="$(printf '%s' "${RESP1}" | sed '$d')"
CODE1="$(printf '%s' "${RESP1}" | tail -n1)"

echo "${BODY1}" | jq . >&2 || true

if [ "${CODE1}" != "200" ]; then
  say "ERROR: expected 200 on first delete; got ${CODE1}"
  exit 1
fi

check_delete_body "${BODY1}" || {
  say "ERROR: first delete body did not match bag-only delete contract"
  exit 1
}

# --- Second delete: expect 404 Not Found (Problem+JSON) ----------------------
attempt=0
max_attempts=3

while :; do
  attempt=$((attempt + 1))
  say "→ DELETE ${DEL_URL} (second delete attempt ${attempt}/${max_attempts})"
  RESP2="$(curl -sS -w '\n%{http_code}' -X DELETE "${DEL_URL}")"
  BODY2="$(printf '%s' "${RESP2}" | sed '$d')"
  CODE2="$(printf '%s' "${RESP2}" | tail -n1)"

  echo "${BODY2}" | jq . >&2 || true

  if [ "${CODE2}" = "404" ]; then
    say "OK: second delete returned 404 (not found). (slug=${SLUG} type=${TYPE} port=${PORT})"
    exit 0
  fi

  # If it's still 200, tolerate potential lag with a short backoff then retry.
  if [ "${CODE2}" = "200" ] && [ "${attempt}" -lt "${max_attempts}" ]; then
    # portable tiny sleep (~0.15s) for macOS bash
    perl -e 'select(undef,undef,undef,0.15);' 2>/dev/null || sleep 1
    continue
  fi

  say "ERROR: expected 404 on second delete; got ${CODE2}"
  exit 1
done
