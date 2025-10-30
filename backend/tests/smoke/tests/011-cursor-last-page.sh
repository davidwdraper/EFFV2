# backend/services/t_entity_crud/smokes/011-cursor-last-page.sh
#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
BASE="http://${HOST}:${PORT}/api/xxx/v1"
LIMIT="${LIMIT:-2}"

say(){ printf '%s\n' "$*" >&2; }

RUN_ID="$(date +%s%N)"

create_one() {
  local i="$1"
  curl -sS -X PUT "${BASE}/create" \
    -H "content-type: application/json" \
    --data "{\"txtfield1\":\"lp\",\"txtfield2\":\"lp_${i}-${RUN_ID}\",\"numfield1\":${i},\"numfield2\":${i}}" \
    | jq -e '.ok == true' >/dev/null
}

say "Seeding 5 docs…"
for i in 1 2 3 4 5; do create_one "$i"; done

cursor=""
total=0
pages=0
while :; do
  if [[ -z "$cursor" ]]; then
    JSON="$(curl -sS "${BASE}/list?limit=${LIMIT}")"
  else
    JSON="$(curl -sS "${BASE}/list?limit=${LIMIT}&cursor=${cursor}")"
  fi
  echo "$JSON" | jq -e '.ok == true' >/dev/null
  count="$(echo "$JSON" | jq '.docs | length')"
  total=$((total + count))
  pages=$((pages + 1))
  cursor="$(echo "$JSON" | jq -r '.nextCursor // empty')"
  if [[ -z "$cursor" ]]; then
    # last page reached
    break
  fi
done

if (( total < 5 )); then
  say "ERROR: expected at least 5 total docs across pages; got ${total}"; exit 1
fi

say "OK: last page reached in ${pages} page(s); nextCursor absent."
exit 0
