# backend/services/t_entity_crud/smokes/011-cursor-last-page.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 011 — cursor last page (seed 5 → paginate with limit → ensure nextCursor
# disappears on the final page). Parametrized for SLUG/HOST/PORT/VERSION/BASE.
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
  local i="$1"
  local url="${BASE}/create"
  say "→ PUT  ${url}  (seed #${i})"
  curl -sS -X PUT "${url}" \
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
  if [ -z "${cursor}" ]; then
    url="${BASE}/list?limit=${LIMIT}"
  else
    url="${BASE}/list?limit=${LIMIT}&cursor=${cursor}"
  fi
  say "→ GET  ${url}"
  JSON="$(curl -sS "${url}")"
  echo "${JSON}" | jq -e '.ok == true' >/dev/null

  count="$(echo "${JSON}" | jq -r '.docs | length')"
  total=$((total + count))
  pages=$((pages + 1))
  cursor="$(echo "${JSON}" | jq -r '.nextCursor // empty')"

  # Uncomment for visibility:
  # say "--- page ${pages} count=${count} nextCursor=${cursor:-<none>} ---"
  # echo "${JSON}" | jq '{docs:(.docs|.[0:5]), nextCursor}'
  
  if [ -z "${cursor}" ]; then
    # last page reached
    break
  fi
done

if [ "${total}" -lt 5 ]; then
  say "ERROR: expected at least 5 total docs across pages; got ${total}"
  exit 1
fi

say "OK: last page reached in ${pages} page(s); nextCursor absent. (slug=${SLUG} port=${PORT})"
exit 0
