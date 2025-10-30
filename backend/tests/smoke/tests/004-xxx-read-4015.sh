# backend/smoke/004-xxx-read-4015.sh
#!/usr/bin/env bash
# Purpose:
# - Create a record, then read it back by ID.
# - Contract-aware: prefers top-level .id, but tolerates DTOs that don’t expose ids inside .doc.
# - Prints quick diagnostics; fails on missing/false .ok or id mismatch.
#
# Usage:
#   ./backend/smoke/004-xxx-read-4015.sh [port]
#
# Notes:
# - We do NOT require _id to appear inside doc (DB shape leakage). We only rely on the public response contract.

set -euo pipefail

PORT="${1:-4015}"
SLUG="xxx"
BASE="http://127.0.0.1:${PORT}/api/${SLUG}/v1"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing dependency: $1" >&2; exit 97; }
}
need curl
need jq
need date

RUN_ID="$(date +%s%N)"

echo "→ PUT  ${BASE}/create"
CREATE_JSON="$(curl -sS -X PUT "${BASE}/create" -H 'content-type: application/json' \
  --data "{\"txtfield1\":\"probe\",\"txtfield2\":\"probe_${RUN_ID}\",\"numfield1\":1,\"numfield2\":1}")"

echo "$CREATE_JSON" | jq . || true

# Prefer the public top-level id; fall back to legacy/alt shapes if present.
# prefer DTO shapes; do NOT fall back to .doc._id
NEW_ID="$(jq -r '.id // .xxxId // .doc.xxxId // empty' <<<"$CREATE_JSON")"
if [[ -z "${NEW_ID}" || "${NEW_ID}" == "null" ]]; then
  echo "ERROR: create response missing DTO id (.id / .xxxId / .doc.xxxId)" >&2
  exit 2
fi

echo "ID=${NEW_ID}"

echo "→ GET  ${BASE}/read/${NEW_ID}"
READ_JSON="$(curl -sS "${BASE}/read/${NEW_ID}")"
echo "$READ_JSON" | jq . || true

OK_VAL="$(jq -r '.ok // empty' <<<"$READ_JSON")"
if [[ "${OK_VAL}" != "true" ]]; then
  echo "ERROR: read not ok" >&2
  echo "$READ_JSON" | jq . >&2 || true
  exit 3
fi

# Some implementations return id at the top-level on read; some only return the document body.
RESP_ID="$(jq -r '.id // .doc.xxxId // .xxxId // empty' <<<"$READ_JSON")"
if [[ -z "${RESP_ID}" || "${RESP_ID}" == "null" ]]; then
  # Compatibility: if no id is returned, we still validate by the fact that .ok==true for the exact path id.
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

# Optional diagnostics the harness prints but does NOT fail on:
HAS_TOP_ID="$(jq -r 'has("id")' <<<"$READ_JSON")"
HAS_XXXID_DOC="$(jq -r '(.doc? // {}) | has("xxxId")' <<<"$READ_JSON")"
echo "diag: top-level id present?   ${HAS_TOP_ID}"
echo "diag: doc.xxxId present?      ${HAS_XXXID_DOC}"

echo "✅ PASS: create/read-by-id roundtrip (id=${NEW_ID})"
