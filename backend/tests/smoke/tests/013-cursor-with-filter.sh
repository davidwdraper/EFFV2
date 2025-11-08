# backend/services/t_entity_crud/smokes/013-cursor-with-filter.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 013 — cursor with filter (matches current API)
# Seeds two groups (groupA, groupB), then pages ONLY groupA with a limit,
# ensuring every returned doc matches the filter across all pages.
#
# Contract (current):
#   PUT  /api/{slug}/v{version}/{type}/create
#        body:  { items: [ { type, doc } ] }
#        resp:  { ok: true }
#   GET  /api/{slug}/v{version}/{type}/list?limit&cursor&txtfield1=groupA
#        resp:  { ok: true, docs: [ { ...fields... } ], nextCursor?: string }
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

require_docs_array() { echo "$1" | jq -e '(.docs | type=="array")' >/dev/null; }
count_docs()        { echo "$1" | jq -r '.docs | length'; }
count_non_groupA()  { echo "$1" | jq -r '[.docs[]? | select(.txtfield1 != "groupA")] | length'; }

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

  # Strict: expect ok==true and docs[]
  echo "${JSON}" | jq -e '.ok == true' >/dev/null
  require_docs_array "${JSON}"

  cnt="$(count_docs "${JSON}")"
  totalA=$((totalA + cnt))

  leak="$(count_non_groupA "${JSON}")"
  if [ "${leak}" -gt 0 ]; then
    seen_nonA=$((seen_nonA + leak))
  fi

  cursor="$(echo "${JSON}" | jq -r '.nextCursor // empty')"
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
