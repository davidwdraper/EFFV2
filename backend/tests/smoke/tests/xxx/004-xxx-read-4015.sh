#!/usr/bin/env bash
# =============================================================================
# Smoke 004 — create + read-by-id roundtrip
#
# Contract:
# - CREATE:
#     PUT /api/:slug/v:version/:dtoType/create
#     body: { items:[{ type, doc:{ _id, ...fields } }] }
#     resp: { ok:true, items:[{ _id, type, ...fields }] }
#
# - READ:
#     GET /api/:slug/v:version/:dtoType/read/:id
#     resp: { ok:true, items:[{ _id, type, ...fields }] }
#
# Rules:
# - `_id` is the external/wire primary key (tests only speak `_id`).
# - Inside the service, DTO exposes `id` via getter; internal only.
# - No legacy shapes; no `doc` on responses; bag-only edges.
#
# macOS Bash 3.2 compatible.
# =============================================================================

set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing dependency: $1" >&2; exit 97; }; }
need curl; need jq; need date

say(){ printf '%s\n' "$*" >&2; }
die(){ say "ERROR: $*"; exit 1; }

# ---- Config ------------------------------------------------------------------
PORT_ARG="${1:-}"
if [ -n "$PORT_ARG" ]; then PORT="$PORT_ARG"; fi

SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"   # overridden by PORT_ARG from smoke.sh
VERSION="${VERSION:-1}"
DTO_TYPE="${DTO_TYPE:-xxx}"

if [ -z "${BASE:-}" ]; then
  BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
fi

RUN_ID="$(date +%s%N)"

# Prefer uuidgen for a stable probe id
if command -v uuidgen >/dev/null 2>&1; then
  REQ_ID="$(uuidgen | tr 'A-Z' 'a-z')"
else
  REQ_ID="$(printf "%s-%06d" "${RUN_ID}" "$RANDOM")"
fi

CREATE_URL="${BASE}/${DTO_TYPE}/create"
READ_BASE="${BASE}/${DTO_TYPE}/read"

say "TEST: 004-xxx-read-4015.sh  (SLUG=${SLUG} DTO_TYPE=${DTO_TYPE} PORT=${PORT} HOST=${HOST})"
say "=============================================================================="

# ---- CREATE (bagged, wire uses _id) -----------------------------------------
say "→ PUT  ${CREATE_URL}"

CREATE_BODY="$(jq -n --arg id "$REQ_ID" --arg type "$DTO_TYPE" '
  {
    items: [
      {
        type: $type,
        doc: {
          _id: $id,
          txtfield1: "probe",
          txtfield2: ("probe_" + $id),
          numfield1: 1,
          numfield2: 1
        }
      }
    ]
  }
')"

echo "${CREATE_BODY}" | jq . >&2 || true

RESP1=$(curl -sS -X PUT "${CREATE_URL}" \
  -H 'content-type: application/json' \
  --data-binary "${CREATE_BODY}" \
  -w '\n%{http_code}')

BODY1="${RESP1%$'\n'*}"
CODE1="${RESP1##*$'\n'}"

[ -n "${CODE1}" ] || die "could not determine HTTP code for create"
[ "${CODE1}" = "200" ] || { say "${BODY1}"; die "create expected HTTP 200"; }

OK=$(printf '%s' "${BODY1}" | jq -r '.ok // false')
[ "${OK}" = "true" ] || { say "${BODY1}"; die "expected ok:true on create"; }

HAS_ITEMS=$(printf '%s' "${BODY1}" | jq -r 'has("items")')
[ "${HAS_ITEMS}" = "true" ] || { say "${BODY1}"; die "create response must be bagged: missing '\''items'\''"; }

ITEMS_LEN=$(printf '%s' "${BODY1}" | jq -r '.items | length')
[ "${ITEMS_LEN}" = "1" ] || { say "${BODY1}"; die "create response must contain exactly one item in '\''items'\''"; }

CREATED_ID=$(printf '%s' "${BODY1}" | jq -r '.items[0]._id // empty')
[ -n "${CREATED_ID}" ] || { say "${BODY1}"; die "bagged dto missing .items[0]._id in create response"; }

CREATED_TYPE=$(printf '%s' "${BODY1}" | jq -r '.items[0].type // empty')
[ "${CREATED_TYPE}" = "${DTO_TYPE}" ] || { say "${BODY1}"; die "create response .items[0].type must equal '${DTO_TYPE}'"; }

# Guard: response item must NOT contain a nested legacy 'doc' wrapper
ITEM_HAS_DOC_CREATE=$(printf '%s' "${BODY1}" | jq -r '.items[0] | has("doc")')
[ "${ITEM_HAS_DOC_CREATE}" = "false" ] || { say "${BODY1}"; die "create response must not contain items[0].doc (DTO JSON is flat)"; }

say "ID=${CREATED_ID}"

# ---- READ by id -------------------------------------------------------------
READ_URL="${READ_BASE}/${CREATED_ID}"
say "→ GET  ${READ_URL}"

READ_RESP=$(curl -sS "${READ_URL}" -w '\n%{http_code}' || true)
READ_BODY="${READ_RESP%$'\n'*}"
READ_CODE="${READ_RESP##*$'\n'}"

[ -n "${READ_CODE}" ] || { say "${READ_BODY}"; die "could not determine HTTP code for read"; }
[ "${READ_CODE}" = "200" ] || { say "${READ_BODY}"; die "read expected HTTP 200"; }

echo "${READ_BODY}" | jq . || true

COUNT="$(printf '%s' "${READ_BODY}" | jq -r '.items | length')"
[ "${COUNT}" = "1" ] || { say "${READ_BODY}"; die "read: expected exactly 1 item, got ${COUNT}"; }

RESP_ID="$(printf '%s' "${READ_BODY}" | jq -r '.items[0]._id // empty')"
RESP_TYPE="$(printf '%s' "${READ_BODY}" | jq -r '.items[0].type // empty')"

[ -n "${RESP_ID}" ] || { say "${READ_BODY}"; die "read response missing items[0]._id"; }
[ "${RESP_ID}" = "${CREATED_ID}" ] || { say "${READ_BODY}"; die "id mismatch (resp:${RESP_ID} != created:${CREATED_ID})"; }

[ -n "${RESP_TYPE}" ] || { say "${READ_BODY}"; die "read response missing items[0].type"; }
[ "${RESP_TYPE}" = "${DTO_TYPE}" ] || { say "${READ_BODY}"; die "type mismatch (resp:${RESP_TYPE} != expected:${DTO_TYPE})"; }

# Guard: read response item must NOT contain a nested legacy 'doc' wrapper
ITEM_HAS_DOC_READ=$(printf '%s' "${READ_BODY}" | jq -r '.items[0] | has("doc")')
[ "${ITEM_HAS_DOC_READ}" = "false" ] || { say "${READ_BODY}"; die "read response must not contain items[0].doc (DTO JSON is flat)"; }

echo "diag: items[0]._id                  ${RESP_ID}"
echo "diag: items[0].type                 ${RESP_TYPE}"

echo "✅ PASS: create/read-by-id roundtrip (id=${CREATED_ID}, slug=${SLUG}, dtoType=${DTO_TYPE}, port=${PORT})"
