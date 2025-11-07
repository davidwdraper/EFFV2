# backend/services/t_entity_crud/smokes/010-batch-cursor.sh
#!/usr/bin/env bash
# =============================================================================
# 010 — Batch cursor pagination (no overlap, deterministic; full cleanup)
# Parametrized: SLUG, HOST, PORT, VERSION, BASE, DTO_TYPE, LIMIT
# =============================================================================
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../../../.." && pwd))"
LIB="$ROOT/backend/tests/smoke/lib.sh"
[ -f "$LIB" ] || { echo "❌ Missing smoke lib: $LIB" >&2; exit 2; }
# shellcheck disable=SC1090
. "$LIB"

SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
DTO_TYPE="${DTO_TYPE:-xxx}"
LIMIT="${LIMIT:-3}"

if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

say(){ printf '%s\n' "$*" >&2; }

RUN_ID="$(date +%s%N)"

mk_create_bag() {
  local t1="$1" t2="$2" n1="$3" n2="$4"
  jq -n --arg type "$DTO_TYPE" --arg t1 "$t1" --arg t2 "$t2" --argjson n1 "$n1" --argjson n2 "$n2" --arg rid "$RUN_ID" '
    {
      items: [
        {
          type: $type,
          doc: {
            txtfield1: $t1,
            txtfield2: ($t2 + "-" + $rid),
            numfield1: $n1,
            numfield2: $n2
          }
        }
      ]
    }
  '
}

list_page() {
  local cursor_q="$1"
  local url
  if [[ -z "${cursor_q}" ]]; then
    url="${BASE}/${DTO_TYPE}/list?limit=${LIMIT}"
  else
    url="${BASE}/${DTO_TYPE}/list?limit=${LIMIT}&cursor=${cursor_q}"
  fi
  _get_json "${url}"
}

# Normalize to an array of DTO docs
normalize_docs() {
  jq '
    if (.docs|type) == "array" then
      .docs
    elif (.items|type) == "array" then
      [ .items[] | (.doc // .) ]
    else
      []
    end
  '
}

# ---- Seed LIMIT+3 docs (capture ids) ----------------------------------------
say "Seeding test docs…"
declare -a CREATED_IDS=()
for i in $(seq 1 $((LIMIT + 3))); do
  BODY="$(mk_create_bag "t1_${i}" "t2_${i}" "${i}" "$((100 + i))")"
  say "→ PUT ${BASE}/${DTO_TYPE}/create"
  echo "$BODY" | jq . >&2 || true
  CRESP="$(_put_json "${BASE}/${DTO_TYPE}/create" "$BODY")"
  echo "$CRESP" | jq -e . >/dev/null || { echo "ERROR: create non-JSON"; echo "$CRESP"; exit 1; }
  [ "$(jq -r '.ok // empty' <<<"$CRESP")" = "true" ] || { echo "ERROR: create failed"; echo "$CRESP" | jq .; exit 1; }
  CID="$(extract_id "$CRESP")"
  [ -n "$CID" ] || { echo "ERROR: missing DTO id in create"; echo "$CRESP" | jq .; exit 1; }
  CREATED_IDS+=( "$CID" )
done

# ---- Page 1 ------------------------------------------------------------------
say "Fetching page 1…"
P1_JSON="$(list_page "")"
echo "$P1_JSON" | jq -e . >/dev/null || { echo "ERROR: list p1 non-JSON"; echo "$P1_JSON"; exit 1; }
[ "$(jq -r '.ok // "true"' <<<"$P1_JSON")" = "true" ] || { echo "ERROR: list p1 failed"; echo "$P1_JSON" | jq .; exit 1; }

P1_DOCS="$(echo "$P1_JSON" | normalize_docs)"
# DTO-only guard: every doc must expose canonical id (ADR-0050)
echo "$P1_DOCS" | jq -e 'all(.[]; has("id"))' >/dev/null || { echo "ERROR: p1 docs missing canonical id"; exit 1; }
read -r -a P1_IDS <<<"$(echo "$P1_DOCS" | jq -r '.[] | .id')"
P1_NEXT="$(jq -r '.nextCursor // empty' <<<"$P1_JSON")"

# ---- Page 2 ------------------------------------------------------------------
say "Fetching page 2…"
P2_JSON="$(list_page "$P1_NEXT")"
echo "$P2_JSON" | jq -e . >/dev/null || { echo "ERROR: list p2 non-JSON"; echo "$P2_JSON"; exit 1; }
[ "$(jq -r '.ok // "true"' <<<"$P2_JSON")" = "true" ] || { echo "ERROR: list p2 failed"; echo "$P2_JSON" | jq .; exit 1; }

P2_DOCS="$(echo "$P2_JSON" | normalize_docs)"
echo "$P2_DOCS" | jq -e 'all(.[]; has("id"))' >/dev/null || { echo "ERROR: p2 docs missing canonical id"; exit 1; }
read -r -a P2_IDS <<<"$(echo "$P2_DOCS" | jq -r '.[] | .id')"
P2_NEXT="$(jq -r '.nextCursor // empty' <<<"$P2_JSON")"

# ---- Assertions --------------------------------------------------------------
((${#P1_IDS[@]} > 0)) || { say "ERROR: page 1 returned 0 docs"; exit 1; }
((${#P2_IDS[@]} > 0)) || { say "ERROR: page 2 returned 0 docs"; exit 1; }

# No overlap
for id1 in "${P1_IDS[@]}"; do
  for id2 in "${P2_IDS[@]}"; do
    [[ "$id1" != "$id2" ]] || { say "ERROR: overlap detected id=${id1:-null}"; exit 1; }
  done
done

say "OK: no overlap; deterministic cursor paging works."
[[ -n "$P2_NEXT" ]] && say "Note: more pages available (nextCursor present)."

# ---- Cleanup -----------------------------------------------------------------
say "Cleaning up ${#CREATED_IDS[@]} docs…"
for id in "${CREATED_IDS[@]}"; do
  DRESP="$(_del_json "${BASE}/${DTO_TYPE}/delete/${id}")"
  if ! jq -e '.ok == true' >/dev/null 2>&1 <<<"$DRESP"; then
    RRESP="$(_get_json "${BASE}/${DTO_TYPE}/read/${id}")" || true
    jq -e '(.status|tostring=="404") or (.code|ascii_upcase=="NOT_FOUND")' >/dev/null 2>&1 <<<"$RRESP" || {
      echo "ERROR: cleanup failed for id=${id}"
      echo "Delete:"; echo "$DRESP" | jq . || echo "$DRESP"
      echo "Read:"; echo "$RRESP" | jq . || echo "$RRESP"
      exit 1
    }
  fi
done

exit 0
