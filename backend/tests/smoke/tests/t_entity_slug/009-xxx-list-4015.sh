# backend/tests/smoke/tests/009-xxx-list-4015.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke 009 — list (create x4 → list → verify → delete x4)
# Parametrized: SLUG, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE, DTO_TYPE
# Leaves no baggage in DB. macOS Bash 3.2 compatible.
# ============================================================================
set -euo pipefail

SMOKE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$SMOKE_DIR/lib.sh"

# --- Config ------------------------------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
DTO_TYPE="${DTO_TYPE:-xxx}"

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

  echo "$CRESP" | jq -e . >/dev/null || { echo "ERROR: create[#${i}]: non-JSON"; echo "$CRESP"; exit 1; }
  OK="$(jq -er '.ok // empty' <<<"$CRESP")"
  [ "$OK" = "true" ] || { echo "ERROR: create[#${i}] failed"; echo "$CRESP" | jq .; exit 1; }

  ID="$(extract_id "$CRESP")"
  [ -n "$ID" ] || { echo "ERROR: create[#${i}]: missing DTO id"; echo "$CRESP" | jq .; exit 1; }

  ids+=( "$ID" )
done

# --- 2) LIST (server no filter; client-filter by PREFIX) ---------------------
echo "→ GET ${BASE}/${DTO_TYPE}/list" >&2
LRESP="$(_get_json "${BASE}/${DTO_TYPE}/list")"
echo "$LRESP" | jq -e . >/dev/null || { echo "ERROR: list: non-JSON"; echo "$LRESP"; exit 1; }

# Be tolerant: some controllers may not stamp { ok:true } yet.
# Treat absence of .ok as ok for now.
LOK="$(jq -r '.ok // "true"' <<<"$LRESP")"
[ "$LOK" = "true" ] || { echo "ERROR: list failed"; echo "$LRESP" | jq .; exit 1; }

# Normalize possible shapes:
#  - bag style: { items:[ { doc:{...} } ] }
#  - flat docs: { docs:[ {...} ] }
#  - bag but flattened items: { items:[ {...} ] }
LIST_DOCS="$(jq '
  if (.docs|type) == "array" then
    .docs
  elif (.items|type) == "array" then
    [ .items[] | (.doc // .) ]
  else
    []
  end
' <<<"$LRESP")"

echo "— Full list response (first 50 normalized docs) —" >&2
jq '.[0:50]' <<<"$LIST_DOCS"

MATCH_JSON="$(jq --arg pfx "${PREFIX}-t2-" '[ .[] | select(.txtfield2 | startswith($pfx)) ]' <<<"$LIST_DOCS")"
COUNT="$(jq -er 'length' <<<"$MATCH_JSON")" || COUNT=0
[ "$COUNT" -eq 4 ] || {
  echo "ERROR: expected 4 matching docs for prefix ${PREFIX}-t2-, got ${COUNT}"
  echo "Matches:"; echo "$MATCH_JSON" | jq .
  exit 1
}

# --- 3) DELETE x4 (cleanup; strict route with dtoType) -----------------------
for id in "${ids[@]}"; do
  echo "→ DELETE ${BASE}/${DTO_TYPE}/delete/${id}" >&2
  DRESP="$(_del_json "${BASE}/${DTO_TYPE}/delete/${id}")"
  echo "$DRESP" | jq -e . >/dev/null || { echo "ERROR: delete: non-JSON"; echo "$DRESP"; exit 1; }

  DOK="$(jq -r '.ok // empty' <<<"$DRESP")"
  if [ "$DOK" != "true" ]; then
    # As a safety net, verify it’s actually gone
    RURL="${BASE}/${DTO_TYPE}/read/${id}"
    echo "→ GET  ${RURL} (post-delete check)" >&2
    RDRESP="$(_get_json "${RURL}")" || true
    if jq -e '(.status|tostring=="404") or (.code|ascii_upcase=="NOT_FOUND")' >/dev/null 2>&1 <<<"$RDRESP"; then
      : # treat as pass
    else
      echo "ERROR: delete did not confirm cleanup for id=${id}"
      echo "Delete response:"; echo "$DRESP" | jq . || echo "$DRESP"
      echo "Read-after-delete:"; echo "$RDRESP" | jq . || echo "$RDRESP"
      exit 1
    fi
  fi
done

echo "OK: list verified; created 4, observed 4, deleted 4 (${SLUG}:${PORT}, dtoType=${DTO_TYPE})"
