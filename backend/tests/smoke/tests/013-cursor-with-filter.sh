# backend/services/t_entity_crud/smokes/013-cursor-with-filter.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 013 — cursor with filter
# Seeds two groups (groupA, groupB), then pages ONLY groupA with a limit,
# ensuring every returned doc matches the filter across all pages.
# Parametrized: SLUG, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE, LIMIT
# macOS Bash 3.2 compatible.
# =============================================================================
set -euo pipefail

# --- Config (env override friendly) ------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"
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

create_one() {
  local group="$1" idx="$2"
  local url="${BASE}/create"
  # group encoded in txtfield1 (filterable); txtfield2 kept unique for index
  say "→ PUT  ${url}  (seed ${group}#${idx})"
  curl -sS -X PUT "${url}" \
    -H "content-type: application/json" \
    --data "{\"txtfield1\":\"${group}\",\"txtfield2\":\"${group}_${idx}-${RUN_ID}\",\"numfield1\":${idx},\"numfield2\":${idx}}" \
    | jq -e '.ok == true' >/dev/null
}

say "Seeding groupA and groupB…"
for i in 1 2 3 4; do create_one "groupA" "$i"; done
for i in 1 2 3 4; do create_one "groupB" "$i"; done

say "Paging groupA only…"
cursor=""
seen_nonA=0
totalA=0
page=0
while :; do
  page=$((page + 1))
  if [ -z "${cursor}" ]; then
    url="${BASE}/list?limit=${LIMIT}&txtfield1=groupA"
  else
    url="${BASE}/list?limit=${LIMIT}&txtfield1=groupA&cursor=${cursor}"
  fi
  say "→ GET  ${url}  (page ${page})"
  JSON="$(curl -sS "${url}")"
  echo "${JSON}" | jq -e '.ok == true' >/dev/null

  count="$(echo "${JSON}" | jq -r '.docs | length')"
  totalA=$((totalA + count))

  # ensure all rows have txtfield1 == groupA
  bad="$(echo "${JSON}" | jq -e '.docs[] | select(.txtfield1 != "groupA")' 2>/dev/null || true)"
  if [ -n "${bad}" ]; then seen_nonA=$((seen_nonA + 1)); fi

  cursor="$(echo "${JSON}" | jq -r '.nextCursor // empty')"
  [ -z "${cursor}" ] && break
done

if [ "${seen_nonA}" -gt 0 ]; then
  say "ERROR: filter leak — found non-groupA rows in filtered paging"
  exit 1
fi
if [ "${totalA}" -lt 4 ]; then
  say "ERROR: expected >=4 groupA rows paged through; got ${totalA}"
  exit 1
fi

say "OK: filter respected across cursor pages. (slug=${SLUG} port=${PORT})"
exit 0
