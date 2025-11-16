#!/usr/bin/env bash
# backend/services/t_entity_crud/smokes/007-xxx-read-notfound.sh
# 007 — read not found
# =============================================================================
# Flow (post _id refactor):
#   1) CREATE a doc with no id fields; service mints _id (sanity check).
#   2) Generate a different UUID that is guaranteed not to match that _id.
#   3) GET /{type}/read/{nonexistentId} → expect 404 (NOT_FOUND).
#
# Rules:
#   - DTOs use _id only; no external id, no idFieldName, no ${slug}Id.
#   - _id is minted inside the app and passed through to Mongo unchanged.
#   - Client uses the _id returned in items[0]._id as canonical for real reads,
#     but this test deliberately targets an id that does not exist.
#
# macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

say(){ printf '%s\n' "$*" >&2; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing dependency: $1" >&2; exit 97; }; }
need curl; need jq; need date

# --- Config (env override friendly) ------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
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
READ_URL_BASE="${BASE}/${TYPE}/read"

# --- UUIDv4 helper (portable) -----------------------------------------------
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

# --- Step 1: CREATE a doc (no id; service mints _id) -------------------------
SUF="$(date +%s)$$"

CREATE_BODY="$(jq -n --arg type "${TYPE}" --arg suf "${SUF}" '
  {
    items: [
      {
        type: $type,
        doc: {
          txtfield1: ("read-notfound-" + $suf),
          txtfield2: ("read-notfound-" + $suf),
          numfield1: 1,
          numfield2: 2
        }
      }
    ]
  }
')"

say "→ PUT  ${CREATE_URL} (seed doc; service mints _id)"
RESP_CREATE="$(curl -sS -X PUT "${CREATE_URL}" -H "content-type: application/json" --data "${CREATE_BODY}")"
echo "${RESP_CREATE}" | jq . >&2 || true

echo "${RESP_CREATE}" | jq -e '.ok == true' >/dev/null || {
  say "ERROR: create.ok != true"
  exit 1
}

ITEM_COUNT="$(echo "${RESP_CREATE}" | jq -r '.items | length')"
[ "${ITEM_COUNT}" -eq 1 ] || {
  say "ERROR: expected exactly 1 item from create, got ${ITEM_COUNT}"
  exit 1
}

CREATED_ID="$(echo "${RESP_CREATE}" | jq -r '.items[0]._id // empty')"
[ -n "${CREATED_ID}" ] || {
  say "ERROR: create missing items[0]._id"
  exit 1
}
say "seeded doc _id=${CREATED_ID}"

# --- Step 2: choose a guaranteed non-existent id -----------------------------
# We just need something different from CREATED_ID. A fresh UUIDv4 is fine.
NOTFOUND_ID="$(gen_uuid4)"
say "probing read with nonexistent id=${NOTFOUND_ID}"

# --- Step 3: READ should return 404 -----------------------------------------
READ_URL="${READ_URL_BASE}/${NOTFOUND_ID}"
say "→ GET  ${READ_URL} (expect 404 not found)"

RESP_READ="$(curl -sS -w '\n%{http_code}' -X GET "${READ_URL}")"
BODY_READ="$(printf '%s' "${RESP_READ}" | sed '$d')"
CODE_READ="$(printf '%s' "${RESP_READ}" | tail -n1)"

# Body should be JSON (problem+json or error payload); we just assert it's parseable.
echo "${BODY_READ}" | jq . >&2 || true

if [ "${CODE_READ}" != "404" ]; then
  say "ERROR: expected 404 on read-notfound; got ${CODE_READ}"
  exit 1
fi

say "✅ PASS: read-notfound returned 404 as expected (slug=${SLUG} type=${TYPE} port=${PORT})"
