# backend/services/t_entity_crud/smokes/010-batch-cursor.sh
#!/usr/bin/env bash
set -euo pipefail

# Docs:
# - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
# - ADRs:
#   - ADR-0047 (DtoBag/DtoBagView + DB-level batching)
#   - ADR-0048 (DbReader/DbWriter contracts)

# Config
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
BASE="http://${HOST}:${PORT}/api/xxx/v1"
LIMIT="${LIMIT:-3}"

say() { printf '%s\n' "$*" >&2; }

# Unique per-run suffix to avoid uniq_txtfield2 collisions
RUN_ID="$(date +%s%N)"

create_one() {
  local t1="$1" t2="$2" n1="$3" n2="$4"
  curl -sS -X PUT "${BASE}/create" \
    -H "content-type: application/json" \
    --data "{\"txtfield1\":\"${t1}\",\"txtfield2\":\"${t2}-${RUN_ID}\",\"numfield1\":${n1},\"numfield2\":${n2}}" \
    | jq -e '.ok == true' >/dev/null
}

list_page() {
  local cursor_q="$1"
  if [[ -z "${cursor_q}" ]]; then
    curl -sS "${BASE}/list?limit=${LIMIT}"
  else
    curl -sS "${BASE}/list?limit=${LIMIT}&cursor=${cursor_q}"
  fi
}

say "Seeding test docs…"
for i in $(seq 1 $((LIMIT + 3))); do
  create_one "t1_${i}" "t2_${i}" "${i}" "$((100 + i))"
done

say "Fetching page 1…"
P1_JSON="$(list_page "")"
echo "${P1_JSON}" | jq -e '.ok == true' >/dev/null
P1_IDS=($(echo "${P1_JSON}" | jq -r '.docs[]._id'))
P1_NEXT="$(echo "${P1_JSON}" | jq -r '.nextCursor // empty')"

say "Fetching page 2…"
P2_JSON="$(list_page "${P1_NEXT}")"
echo "${P2_JSON}" | jq -e '.ok == true' >/dev/null
P2_IDS=($(echo "${P2_JSON}" | jq -r '.docs[]._id'))
P2_NEXT="$(echo "${P2_JSON}" | jq -r '.nextCursor // empty')"

# Assertions: sizes and no overlap
if (( ${#P1_IDS[@]} == 0 )); then
  say "ERROR: page 1 returned 0 docs"; exit 1
fi
if (( ${#P2_IDS[@]} == 0 )); then
  say "ERROR: page 2 returned 0 docs"; exit 1
fi

# Check no overlap
for id1 in "${P1_IDS[@]}"; do
  for id2 in "${P2_IDS[@]}"; do
    if [[ "${id1}" == "${id2}" ]]; then
      say "ERROR: overlap detected id=${id1}"; exit 1
    fi
  done
done

say "OK: no overlap; deterministic cursor paging works."
[[ -n "${P2_NEXT}" ]] && say "Note: more pages available (nextCursor present)."

exit 0
