# backend/smoke/004-xxx-read-4015.sh
#!/usr/bin/env bash
# Purpose:
# - Create a record (DtoBag) with a caller-provided id, then read it back by that id.
# - Contract-aware: prefers public DTO ids; never depends on DB _id.
# - Prints each curl; fails on id/type mismatch or DB-shape leaks.
#
# Usage:
#   ./backend/smoke/004-xxx-read-4015.sh [port]
#
# Param env (optional):
#   SLUG=xxx HOST=127.0.0.1 PORT=4015 VERSION=1 DTO_TYPE=xxx BASE=http://host:port/api/<slug>/v<version>
# Notes:
# - Wire is a DtoBag: { items: [ { id, type, ...dtoFields } ], meta?: {...} }
# - Backend requires DTO to carry a valid 'id' before persistence.

set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing dependency: $1" >&2; exit 97; }; }
need curl; need jq; need date

# ---- Config ------------------------------------------------------------------
PORT_ARG="${1:-}"
if [ -n "$PORT_ARG" ]; then PORT="$PORT_ARG"; fi

SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
DTO_TYPE="${DTO_TYPE:-xxx}"

# Precedence: BASE env (if set) > computed from HOST/PORT (dtoType appended per call)
if [ -z "${BASE:-}" ]; then
  BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
fi

RUN_ID="$(date +%s%N)"

# Make a stable request id for the DTO we're creating; prefer uuidgen.
if command -v uuidgen >/dev/null 2>&1; then
  REQ_ID="$(uuidgen | tr 'A-Z' 'a-z')"
else
  REQ_ID="$(printf "%s-%06d" "${RUN_ID}" "$RANDOM")"
fi

# ---- CREATE (DtoBag) ---------------------------------------------------------
CREATE_URL="${BASE}/${DTO_TYPE}/create"
echo "→ PUT  ${CREATE_URL}" >&2

# Build DtoBag with both id and <slug>Id (the backend ignores the latter if unused; safe for future mappers).
CREATE_BODY="$(jq -n --arg rid "$REQ_ID" --arg type "$DTO_TYPE" --arg k "${SLUG}Id" '
  {
    items: [
      {
        type: $type,
        doc: {
          id: $rid,
          txtfield1: "probe",
          txtfield2: ("probe_" + $rid),
          numfield1: 1,
          numfield2: 1
        }
      }
    ]
  }
  | (.items[0].doc[$k] = $rid)
')"

echo "$CREATE_BODY" | jq . >&2 || true

CREATE_JSON="$(curl -fsS -X PUT "${CREATE_URL}" -H 'content-type: application/json' --data "$CREATE_BODY")"
echo "$CREATE_JSON" | jq . || true

# Try to read back any id the service echoes; if absent, we trust what we sent.
CREATED_ID_FROM_RESP="$(jq -r --arg k "${SLUG}Id" '
  .id // .doc[$k] // .[$k] // .items[0].doc.id // .items[0].doc[$k] // .items[0][$k] // empty
' <<<"$CREATE_JSON")"

if [[ -n "${CREATED_ID_FROM_RESP}" && "${CREATED_ID_FROM_RESP}" != "null" && "${CREATED_ID_FROM_RESP}" != "${REQ_ID}" ]]; then
  echo "ERROR: service echoed a different id (resp:${CREATED_ID_FROM_RESP} != sent:${REQ_ID})" >&2
  exit 2
fi

NEW_ID="${REQ_ID}"
echo "ID=${NEW_ID}"

# ---- READ --------------------------------------------------------------------
READ_URL="${BASE}/${DTO_TYPE}/read/${NEW_ID}"
echo "→ GET  ${READ_URL}" >&2
READ_JSON="$(curl -fsS "${READ_URL}")"
echo "$READ_JSON" | jq . || true

# Require exactly one item
COUNT="$(jq -r '.items | length' <<<"$READ_JSON")"
if [ "$COUNT" != "1" ]; then
  echo "ERROR: expected exactly 1 item, got ${COUNT}" >&2
  exit 3
fi

# Extract id and type from the new read contract (bag-only, flat item fields)
RESP_ID="$(jq -r '.items[0].id // empty' <<<"$READ_JSON")"
RESP_TYPE="$(jq -r '.items[0].type // empty' <<<"$READ_JSON")"

if [[ -z "${RESP_ID}" || "${RESP_ID}" == "null" ]]; then
  echo "ERROR: read response missing items[0].id" >&2
  exit 4
fi

if [[ "${RESP_ID}" != "${NEW_ID}" ]]; then
  echo "ERROR: id mismatch (resp:${RESP_ID} != created:${NEW_ID})" >&2
  exit 5
fi

if [[ -z "${RESP_TYPE}" || "${RESP_TYPE}" != "${DTO_TYPE}" ]]; then
  echo "ERROR: type mismatch (resp:${RESP_TYPE} != expected:${DTO_TYPE})" >&2
  exit 6
fi

# Assert we are NOT leaking DB shapes back out (no _id anywhere in items[0])
DOC_HAS_DB_ID="$(jq -r '(.items[0] | has("_id"))' <<<"$READ_JSON")"
if [[ "${DOC_HAS_DB_ID}" == "true" ]]; then
  echo "ERROR: response leaks DB shape (_id present on item). Contract expects DTO-only json." >&2
  exit 7
fi

# Optional diagnostics (do not fail)
HAS_TOP_ID="$(jq -r 'has("id")' <<<"$READ_JSON")"
echo "diag: top-level id present?         ${HAS_TOP_ID}"
echo "diag: items[0].id?                  true"
echo "diag: items[0].type?                ${RESP_TYPE}"

echo "✅ PASS: create/read-by-id roundtrip (id=${NEW_ID}, slug=${SLUG}, dtoType=${DTO_TYPE}, port=${PORT})"
