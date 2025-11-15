# backend/tests/smoke/tests/xxx/009-xxx-list-4015.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke 009 — list (create x4 → list → verify → delete x4)
# Parametrized: SLUG, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE, DTO_TYPE
# Leaves no baggage in DB. macOS Bash 3.2 compatible.
# ============================================================================
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../../../.." && pwd))"
LIB="$ROOT/backend/tests/smoke/lib.sh"
if [ ! -f "$LIB" ]; then
  echo "❌ Missing smoke lib: $LIB" >&2
  exit 2
fi
# shellcheck disable=SC1090
. "$LIB"

# --- Config ------------------------------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
DTO_TYPE="${DTO_TYPE:-xxx}"

# Crank this up so our 4 docs land in the first page.
LIST_LIMIT="${LIST_LIMIT:-1000}"

# Precedence: BASE (if provided) > SVCFAC_BASE_URL > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

REQROOT="smoke-009"
SUF="${RANDOM}"            # unique marker for this run
PREFIX="u9-${SUF}"         # used to find our docs in the list
ids=()

# Helper: build a proper DtoBag for create
mk_create_bag() {
  i="$1"
  jq -n --arg type "$DTO_TYPE" --arg pfx "$PREFIX" --argjson i "$i" '
    {
      items: [
        {
          type: $type,
          doc: {
            txtfield1: ($pfx + "-t1-" + ($i|tostring)),
            txtfield2: ($pfx + "-t2-" + ($i|tostring)),
            numfield1: $i,
            numfield2: ($i * 10)
          }
        }
      ]
    }
  '
}

# --- 1) CREATE x4 ------------------------------------------------------------
for i in 1 2 3 4; do
  BODY="$(mk_create_bag "$i")"
  echo "→ PUT ${BASE}/${DTO_TYPE}/create" >&2
  echo "$BODY" | jq . >&2 || true

  CRESP="$(_put_json "${BASE}/${DTO_TYPE}/create" "${BODY}")"

  if ! echo "$CRESP" | jq -e . >/dev/null 2>&1; then
    echo "ERROR: create[#${i}]: non-JSON" >&2
    echo "$CRESP"
    exit 1
  fi

  OK="$(echo "$CRESP" | jq -er '.ok // empty' 2>/dev/null || echo "")"
  if [ "$OK" != "true" ]; then
    echo "ERROR: create[#${i}] failed" >&2
    echo "$CRESP" | jq .
    exit 1
  fi

  ID="$(extract_id "$CRESP")"
  if [ -z "$ID" ]; then
    echo "ERROR: create[#${i}]: missing DTO id" >&2
    echo "$CRESP" | jq .
    exit 1
  fi

  ids+=( "$ID" )
done

# --- 2) LIST (server no filter; client-filter by PREFIX) ---------------------
echo "→ GET ${BASE}/${DTO_TYPE}/list?limit=${LIST_LIMIT}" >&2
LRESP="$(_get_json "${BASE}/${DTO_TYPE}/list?limit=${LIST_LIMIT}")"

if ! echo "$LRESP" | jq -e . >/dev/null 2>&1; then
  echo "ERROR: list: non-JSON" >&2
  echo "$LRESP"
  exit 1
fi

LOK="$(echo "$LRESP" | jq -r '.ok // "true"')"
if [ "$LOK" != "true" ]; then
  echo "ERROR: list failed" >&2
  echo "$LRESP" | jq .
  exit 1
fi

# Normalize shape to plain docs array
LIST_DOCS="$(
  echo "$LRESP" | jq '
    if (.docs|type) == "array" then
      .docs
    elif (.items|type) == "array" then
      [ .items[] | (.doc // .) ]
    else
      []
    end
  '
)"

echo "— Full list response (first 50 normalized docs) —" >&2
echo "$LIST_DOCS" | jq '.[0:50]'

MATCH_JSON="$(
  echo "$LIST_DOCS" | jq --arg pfx "${PREFIX}-t2-" '
    [ .[] | select(.txtfield2 | startswith($pfx)) ]
  '
)"

COUNT="$(echo "$MATCH_JSON" | jq -er 'length' 2>/dev/null || echo 0)"

if [ "$COUNT" -ne 4 ]; then
  echo "ERROR: expected 4 matching docs for prefix ${PREFIX}-t2-, got ${COUNT}" >&2
  echo "Matches:" >&2
  echo "$MATCH_JSON" | jq .
  exit 1
fi

# --- 3) DELETE x4 (cleanup; strict route with dtoType) -----------------------
for id in "${ids[@]}"; do
  echo "→ DELETE ${BASE}/${DTO_TYPE}/delete/${id}" >&2
  DRESP="$(_del_json "${BASE}/${DTO_TYPE}/delete/${id}")"

  if ! echo "$DRESP" | jq -e . >/dev/null 2>&1; then
    echo "ERROR: delete: non-JSON" >&2
    echo "$DRESP"
    exit 1
  fi

  DOK="$(echo "$DRESP" | jq -r '.ok // empty')"
  if [ "$DOK" != "true" ]; then
    # Safety net: verify it’s actually gone
    RURL="${BASE}/${DTO_TYPE}/read/${id}"
    echo "→ GET  ${RURL} (post-delete check)" >&2
    RDRESP="$(_get_json "${RURL}")" || true

    if ! echo "$RDRESP" | jq -e '(.status|tostring=="404") or (.code|ascii_upcase=="NOT_FOUND")' >/dev/null 2>&1; then
      echo "ERROR: delete did not confirm cleanup for id=${id}" >&2
      echo "Delete response:" >&2
      echo "$DRESP" | jq . || echo "$DRESP"
      echo "Read-after-delete:" >&2
      echo "$RDRESP" | jq . || echo "$RDRESP"
      exit 1
    fi
  fi
done

echo "OK: list verified; created 4, observed 4, deleted 4 (${SLUG}:${PORT}, dtoType=${DTO_TYPE})"
