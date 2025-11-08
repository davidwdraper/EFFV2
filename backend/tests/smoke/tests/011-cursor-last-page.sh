# backend/services/t_entity_crud/smokes/011-cursor-last-page.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 011 — cursor last page
# Goal: seed 5 docs → paginate with ?limit → ensure nextCursor disappears on the
# final page. Aligned to bag-first + dtoType-aware routes (…/v{n}/{type}/…).
#
# Params (env-override friendly):
#   SLUG=xxx HOST=127.0.0.1 PORT=4015 VERSION=1 TYPE=xxx LIMIT=2
#   BASE (optional) or SVCFAC_BASE_URL (optional) for root base URL.
#
# References:
# - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
# - ADRs:
#     ADR-0040 (DTO-Only Persistence)
#     ADR-0041 (Per-Route Controllers)
#     ADR-0042 (HandlerContext Bus — KISS)
#     ADR-0049 (DTO Registry & canonical id)
#     ADR-0050 (Wire Bag Envelope)
#     ADR-0053 (Bag Purity & Wire Envelope Separation)
#
# macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

# --- Config ---------------------------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
# Make TYPE track DTO_TYPE, which itself defaults to SLUG
DTO_TYPE="${DTO_TYPE:-$SLUG}"
TYPE="${TYPE:-$DTO_TYPE}"
LIMIT="${LIMIT:-2}"

# Build a root BASE (without the {type} segment).
# Precedence: explicit BASE > SVCFAC_BASE_URL > http://HOST:PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

say(){ printf '%s\n' "$*" >&2; }

RUN_ID="$(date +%s%N)"

# --- Helpers --------------------------------------------------------------
create_one() {
  local i="$1"
  local url="${BASE}/${TYPE}/create"
  say "→ PUT  ${url}  (seed #${i})"
  # Bag-first payload: items[ { type, doc } ]
  # Accept either a bag-shaped response (.items) OR legacy { ok: true }.
  curl -sS -X PUT "${url}" \
    -H "content-type: application/json" \
    --data "{\"items\":[{\"type\":\"${TYPE}\",\"doc\":{\"txtfield1\":\"lp\",\"txtfield2\":\"lp_${i}-${RUN_ID}\",\"numfield1\":${i},\"numfield2\":${i}}}]}" \
  | jq -e 'if has("items") then (.items|length>=1) else (.ok==true) end' >/dev/null
}

list_page() {
  local limit="$1"
  local cursor="${2:-}"
  local url
  if [ -z "${cursor}" ]; then
    url="${BASE}/${TYPE}/list?limit=${limit}"
  else
    url="${BASE}/${TYPE}/list?limit=${limit}&cursor=${cursor}"
  fi
  say "→ GET  ${url}"
  curl -sS "${url}"
}

# --- Seed -----------------------------------------------------------------
say "Seeding 5 docs…"
for i in 1 2 3 4 5; do create_one "$i"; done

# --- Paginate -------------------------------------------------------------
cursor=""
total=0
pages=0

while :; do
  JSON="$(list_page "${LIMIT}" "${cursor}")"

  # Prefer bag-first shape; fall back to legacy .docs if needed.
  count="$(echo "${JSON}" | jq -r 'if has("items") then (.items|length) else (.docs // [] | length) end')"
  total=$((total + count))
  pages=$((pages + 1))

  cursor="$(echo "${JSON}" | jq -r '.nextCursor // empty')"

  # Uncomment for visibility:
  # say "--- page ${pages} count=${count} nextCursor=${cursor:-<none>} ---"
  # echo "${JSON}" | jq '{items, docs, nextCursor}'
  
  if [ -z "${cursor}" ]; then
    break
  fi
done

if [ "${total}" -lt 5 ]; then
  say "ERROR: expected at least 5 total docs across pages; got ${total}"
  exit 1
fi

say "OK: last page reached in ${pages} page(s); nextCursor absent. (slug=${SLUG} type=${TYPE} port=${PORT})"
exit 0
