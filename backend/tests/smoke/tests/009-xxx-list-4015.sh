# backend/tests/smoke/tests/009-xxx-list-4015.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke 009 — list (create x4 → list → delete x4)
# Parametrized: SLUG, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE
# Leaves no baggage in DB. macOS Bash 3.2 compatible.
# ============================================================================
set -euo pipefail

SMOKE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$SMOKE_DIR/lib.sh"

# --- Config (env override friendly) ------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
VERSION="${VERSION:-1}"

# Precedence: BASE (if provided) > SVCFAC_BASE_URL > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

SUF="${RANDOM}"            # unique marker for this run
PREFIX="u9-${SUF}"         # used to find our docs in the list
REQROOT="smoke-009"

ids=()

# 1) CREATE x4 ----------------------------------------------------------------
for i in 1 2 3 4; do
  BODY="$(cat <<JSON
{
  "txtfield1": "${PREFIX}-t1-${i}",
  "txtfield2": "${PREFIX}-t2-${i}",
  "numfield1": ${i},
  "numfield2": $((i * 10))
}
JSON
)"
  CRESP="$(_put_json "${BASE}/create" "${BODY}")"

  # Validate and extract id (slug-aware)
  echo "${CRESP}" | jq -e . >/dev/null || { echo "ERROR: create[#${i}]: non-JSON"; echo "${CRESP}"; exit 1; }
  OK="$(jq -er '.ok' <<<"${CRESP}")" || { echo "ERROR: create[#${i}]: missing .ok"; echo "${CRESP}"; exit 1; }
  [ "${OK}" = "true" ] || { echo "ERROR: create[#${i}] failed"; echo "${CRESP}" | jq .; exit 1; }

  ID="$(extract_id "${CRESP}")"
  [ -n "${ID}" ] || { echo "ERROR: create[#${i}]: missing DTO id"; echo "${CRESP}" | jq .; exit 1; }

  ids+=( "${ID}" )
done

# 2) LIST (no server filter; client-filter by our unique PREFIX) --------------
LRESP="$(_get_json "${BASE}/list")"

LOK="$(jq -er '.ok' <<<"${LRESP}")" || { echo "ERROR: list: non-JSON or missing .ok"; echo "${LRESP}"; exit 1; }
[ "${LOK}" = "true" ] || { echo "ERROR: list failed"; echo "${LRESP}" | jq .; exit 1; }

# Show the first 50 docs for visibility
echo "— Full list response (truncated to 50 docs for sanity) —" >&2
jq '.docs | .[0:50]' <<<"${LRESP}"

# Pull only our 4 fresh docs by matching txtfield2 prefix
MATCH_JSON="$(jq --arg pfx "${PREFIX}-t2-" '[.docs[] | select(.txtfield2 | startswith($pfx))]' <<<"${LRESP}")"
COUNT="$(jq -er 'length' <<<"${MATCH_JSON}")" || COUNT=0
[ "${COUNT}" -eq 4 ] || {
  echo "ERROR: expected 4 matching docs for prefix ${PREFIX}-t2-, got ${COUNT}"
  echo "Matches:"; echo "${MATCH_JSON}" | jq .
  exit 1
}

# 3) DELETE x4 ----------------------------------------------------------------
for id in "${ids[@]}"; do
  DRESP="$(_del_json "${BASE}/${id}")"

  DOK="$(jq -er '.ok' <<<"${DRESP}" 2>/dev/null || echo "false")"
  if [ "${DOK}" != "true" ]; then
    # Fallback: verify not found via read
    RURL="${BASE}/read?${SLUG}Id=${id}"
    echo "→ GET  ${RURL} (post-delete check)" >&2
    RDRESP="$(curl -sS "${RURL}" -H "x-request-id: ${REQROOT}-read-postdel-${id}" || true)"
    if jq -e '(.status|tostring=="404") or (.code|ascii_upcase=="NOT_FOUND")' >/dev/null 2>&1 <<<"${RDRESP}"; then
      : # treat as pass
    else
      echo "ERROR: delete did not confirm cleanup for id=${id}"
      echo "Delete response:"; echo "${DRESP}" | jq . || echo "${DRESP}"
      echo "Read-after-delete:"; echo "${RDRESP}" | jq . || echo "${RDRESP}"
      exit 1
    fi
  fi
done

echo "OK: list verified; created 4, observed 4, deleted 4 (${SLUG}:${PORT})"
