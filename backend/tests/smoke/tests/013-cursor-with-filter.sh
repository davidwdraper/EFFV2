# backend/services/t_entity_crud/smokes/013-cursor-with-filter.sh
#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
BASE="http://${HOST}:${PORT}/api/xxx/v1"
LIMIT="${LIMIT:-2}"

say(){ printf '%s\n' "$*" >&2; }

RUN_ID="$(date +%s%N)"

create_one() {
  local group="$1" idx="$2"
  # group encoded in txtfield1 (filterable); txtfield2 kept unique for index
  curl -sS -X PUT "${BASE}/create" \
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
while :; do
  if [[ -z "$cursor" ]]; then
    JSON="$(curl -sS "${BASE}/list?limit=${LIMIT}&txtfield1=groupA")"
  else
    JSON="$(curl -sS "${BASE}/list?limit=${LIMIT}&txtfield1=groupA&cursor=${cursor}")"
  fi
  echo "$JSON" | jq -e '.ok == true' >/dev/null
  count="$(echo "$JSON" | jq '.docs | length')"
  totalA=$((totalA + count))

  # ensure all rows have txtfield1 == groupA
  bad="$(echo "$JSON" | jq -e '.docs[] | select(.txtfield1 != "groupA")' 2>/dev/null || true)"
  if [[ -n "$bad" ]]; then seen_nonA=$((seen_nonA + 1)); fi

  cursor="$(echo "$JSON" | jq -r '.nextCursor // empty')"
  [[ -z "$cursor" ]] && break
done

if (( seen_nonA > 0 )); then
  say "ERROR: filter leak — found non-groupA rows in filtered paging"; exit 1
fi
if (( totalA < 4 )); then
  say "ERROR: expected >=4 groupA rows paged through; got ${totalA}"; exit 1
fi

say "OK: filter respected across cursor pages."
exit 0
