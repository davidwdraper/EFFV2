#!/usr/bin/env bash
# backend/services/t_entity_crud/smokes/013-cursor-with-filter.sh
# 013 — cursor with filter 
# =============================================================================
# Seeds two groups (groupA, groupB), then pages ONLY groupA with a limit,
# ensuring every returned doc matches the filter across all pages.
#
# Contract (current, bag-only edge):
#   PUT  /api/{slug}/v{version}/{type}/create
#        body:  { items: [ { type, doc } ] }
#        resp:  { ok: true, items: [...], meta: {...} }
#   GET  /api/{slug}/v{version}/{type}/list?limit&cursor&txtfield1=groupA
#        resp:  { ok: true, items: [...], meta: {...} }
#        (Compat: may also surface docs[] / nextCursor, but not required.)
#
# Params (env-override friendly):
#   SLUG=xxx HOST=127.0.0.1 PORT=4015 VERSION=1 TYPE=xxx LIMIT=2
#   BASE (optional) or SVCFAC_BASE_URL (optional)
#
# macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

# --- Config ------------------------------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
# TYPE should follow DTO_TYPE, which itself defaults to SLUG
DTO_TYPE="${DTO_TYPE:-$SLUG}"
TYPE="${TYPE:-$DTO_TYPE}"
LIMIT="${LIMIT:-2}"

# Precedence: BASE (if provided) > SVCFAC_BASE_URL > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

say(){ printf '%s\n' "$*" >&2; }

RUN_ID="$(date +%s%N)"

# --- Helpers -----------------------------------------------------------------
create_one() {
  local group="$1" idx="$2"
  local url="${BASE}/${TYPE}/create"
  say "→ PUT  ${url}  (seed ${group}#${idx})"
  RESP="$(
    curl -sS -X PUT "${url}" \
      -H "content-type: application/json" \
      --data "{\"items\":[{\"type\":\"${TYPE}\",\"doc\":{\"txtfield1\":\"${group}\",\"txtfield2\":\"${group}_${idx}-${RUN_ID}\",\"numfield1\":${idx},\"numfield2\":${idx}}}]}"
  )"
  echo "${RESP}" | jq -e '.ok == true' >/dev/null
}

# Normalize any supported list shape to a plain docs[] array:
# - { docs: [ {..} ] }
# - { items: [ { doc: {...} } ] }
# - { items: [ { ... } ] }
normalize_docs() {
  echo "$1" | jq '
    if (.docs|type) == "array" then
      .docs
    elif (.items|type) == "array" then
      [ .items[] | (.doc // .) ]
    else
      []
    end
  '
}

count_docs() {
  normalize_docs "$1" | jq -r 'length'
}

count_non_groupA() {
  normalize_docs "$1" | jq -r '[.[]? | select(.txtfield1 != "groupA")] | length'
}

# --- Seed --------------------------------------------------------------------
say "Seeding groupA and groupB…"
for i in 1 2 3 4; do create_one "groupA" "$i"; done
for i in 1 2 3 4; do create_one "groupB" "$i"; done

# --- Page filter -------------------------------------------------------------
say "Paging groupA only…"
cursor=""
seen_nonA=0
totalA=0
page=0

while :; do
  page=$((page + 1))
  if [ -z "${cursor}" ]; then
    url="${BASE}/${TYPE}/list?limit=${LIMIT}&txtfield1=groupA"
  else
    url="${BASE}/${TYPE}/list?limit=${LIMIT}&txtfield1=groupA&cursor=${cursor}"
  fi
  say "→ GET  ${url}  (page ${page})"
  JSON="$(curl -sS "${url}")"

  # Strict on success flag and JSON shape; flexible on envelope fields.
  echo "${JSON}" | jq -e '.ok == true' >/dev/null

  cnt="$(count_docs "${JSON}")"
  totalA=$((totalA + cnt))

  leak="$(count_non_groupA "${JSON}")"
  if [ "${leak}" -gt 0 ]; then
    seen_nonA=$((seen_nonA + leak))
  fi

  cursor="$(echo "${JSON}" | jq -r '.nextCursor // .meta.nextCursor // empty')"
  [ -z "${cursor}" ] && break
done

# --- Assertions --------------------------------------------------------------
if [ "${seen_nonA}" -gt 0 ]; then
  say "ERROR: filter leak — found ${seen_nonA} non-groupA row(s) in filtered paging"
  exit 1
fi
if [ "${totalA}" -lt 4 ]; then
  say "ERROR: expected >=4 groupA rows paged through; got ${totalA}"
  exit 1
fi

say "OK: filter respected across cursor pages. (slug=${SLUG} type=${TYPE} port=${PORT})"
exit 0
