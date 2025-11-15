# backend/services/t_entity_crud/smokes/006-xxx-delete-notfound-4015.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 006 — delete not found (STRICT, _id-only)
#
# Flow (post _id refactor):
#   1) CREATE a doc with no id fields; service mints _id.
#   2) DELETE /{type}/delete/{_id} → expect 200 { ok:true, deleted:1 }.
#   3) DELETE /{type}/delete/{_id} again → expect 404 (NOT_FOUND),
#      with a short backoff loop to tolerate async delete commits.
#
# Rules:
#   - DTOs use _id only; no external id, no idFieldName, no ${slug}Id.
#   - _id is minted inside the app and passed through to Mongo unchanged.
#   - Client uses the _id returned in items[0]._id as the canonical id.
#   - Delete contract: { ok:true, deleted:1 } is sufficient; id echo is optional.
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

# --- First delete: must succeed ----------------------------------------------
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

echo "${BODY1}" | jq -e '.ok == true and .deleted == 1' >/dev/null || {
  say "ERROR: first delete body mismatch (expected ok:true, deleted:1)"
  exit 1
}

# --- Second delete: expect 404 (with short backoff retries) -------------------
attempt=0
max_attempts=3

while :; do
  attempt=$((attempt + 1))
  say "→ DELETE ${DEL_URL} (second delete attempt ${attempt}/${max_attempts})"
  RESP2="$(curl -sS -w '\n%{http_code}' -X DELETE "${DEL_URL}")"
  BODY2="$(printf '%s' "${RESP2}" | sed '$d')"
  CODE2="$(printf '%s' "${RESP2}" | tail -n1)"

  echo "${BODY2}" | jq . >&2 || true

  # If 404, we're done.
  if [ "${CODE2}" = "404" ]; then
    say "OK: second delete returned 404 (not found). (slug=${SLUG} type=${TYPE} port=${PORT})"
    exit 0
  fi

  # If still 200 deleted:1, likely eventual-consistency issue; short backoff then retry.
  if [ "${CODE2}" = "200" ] && echo "${BODY2}" | jq -e '.deleted == 1' >/dev/null 2>&1; then
    if [ "${attempt}" -lt "${max_attempts}" ]; then
      # portable tiny sleep (~0.15s) for macOS bash
      perl -e 'select(undef,undef,undef,0.15);' 2>/dev/null || sleep 1
      continue
    fi
  fi

  say "ERROR: expected 404 on second delete; got ${CODE2}"
  exit 1
done
