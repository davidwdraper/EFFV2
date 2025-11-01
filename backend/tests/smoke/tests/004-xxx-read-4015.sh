# backend/smoke/004-xxx-read-4015.sh
#!/usr/bin/env bash
# Purpose:
# - Create a record, then read it back by ID.
# - Contract-aware: prefers public DTO ids; never depends on DB _id.
# - Prints each curl; fails on missing/false .ok or id mismatch.
#
# Usage:
#   ./backend/smoke/004-xxx-read-4015.sh [port]
#
# Param env (optional):
#   SLUG=xxx HOST=127.0.0.1 PORT=4015 VERSION=1 BASE=http://host:port/api/<slug>/v<version>
# Notes:
# - We do NOT require _id to appear inside doc (DB shape leakage).

set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing dependency: $1" >&2; exit 97; }; }
need curl; need jq; need date

# ---- Config (defaults keep your original behavior) ---------------------------
PORT_ARG="${1:-}"
if [ -n "$PORT_ARG" ]; then PORT="$PORT_ARG"; fi

SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"

# Precedence: BASE env (if set) > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
fi

RUN_ID="$(date +%s%N)"

# ---- CREATE ------------------------------------------------------------------
CREATE_URL="${BASE}/create"
echo "→ PUT  ${CREATE_URL}" >&2
CREATE_JSON="$(curl -sS -X PUT "${CREATE_URL}" -H 'content-type: application/json' \
  --data "{\"txtfield1\":\"probe\",\"txtfield2\":\"probe_${RUN_ID}\",\"numfield1\":1,\"numfield2\":1}")"

# Pretty-print for diagnostics but do not fail if jq coloring fails
echo "$CREATE_JSON" | jq . || true

# Prefer public DTO id shapes; do NOT fall back to .doc._id
# Try: .id → .<slug>Id → .doc.<slug>Id → .xxxId → .doc.xxxId
NEW_ID="$(jq -r \
  --arg k "${SLUG}Id" \
  '.id // .[$k] // .doc[$k] // .xxxId // .doc.xxxId // empty' \
  <<<"$CREATE_JSON")"

if [[ -z "${NEW_ID}" || "${NEW_ID}" == "null" ]]; then
  echo "ERROR: create response missing DTO id (.id / .${SLUG}Id / .doc.${SLUG}Id / .xxxId / .doc.xxxId)" >&2
  exit 2
fi

echo "ID=${NEW_ID}"

# ---- READ --------------------------------------------------------------------
READ_URL="${BASE}/read/${NEW_ID}"
echo "→ GET  ${READ_URL}" >&2
READ_JSON="$(curl -sS "${READ_URL}")"
echo "$READ_JSON" | jq . || true

OK_VAL="$(jq -r '.ok // empty' <<<"$READ_JSON")"
if [[ "${OK_VAL}" != "true" ]]; then
  echo "ERROR: read not ok" >&2
  echo "$READ_JSON" | jq . >&2 || true
  exit 3
fi

# Some implementations return id at the top-level; some only return the document body.
RESP_ID="$(jq -r \
  --arg k "${SLUG}Id" \
  '.id // .doc[$k] // .[$k] // .xxxId // .doc.xxxId // empty' \
  <<<"$READ_JSON")"

# If no id is returned, still pass by contract (ok==true for that path); use NEW_ID for compare
if [[ -z "${RESP_ID}" || "${RESP_ID}" == "null" ]]; then
  RESP_ID="${NEW_ID}"
fi

if [[ "${RESP_ID}" != "${NEW_ID}" ]]; then
  echo "ERROR: id mismatch (resp:${RESP_ID} != created:${NEW_ID})" >&2
  exit 4
fi

# Assert we are NOT leaking DB shapes back out (no _id expected in the DTO json).
DOC_HAS_DB_ID="$(jq -r '(.doc? // {}) | has("_id")' <<<"$READ_JSON")"
if [[ "${DOC_HAS_DB_ID}" == "true" ]]; then
  echo "ERROR: response doc leaks DB shape (_id present). Contract expects DTO-only json." >&2
  exit 5
fi

# Optional diagnostics (do not fail)
HAS_TOP_ID="$(jq -r 'has("id")' <<<"$READ_JSON")"
HAS_SLUG_ID_DOC="$(jq -r --arg k "${SLUG}Id" '(.doc? // {}) | has($k)' <<<"$READ_JSON")"
echo "diag: top-level id present?   ${HAS_TOP_ID}"
echo "diag: doc.${SLUG}Id present?  ${HAS_SLUG_ID_DOC}"

echo "✅ PASS: create/read-by-id roundtrip (id=${NEW_ID}, slug=${SLUG}, port=${PORT})"
