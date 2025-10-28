# scripts/smoke/smoke-015-facilitator-route-policy.sh
# -----------------------------------------------------------------------------
# Smoke 015: SvcFacilitator routePolicy CRUD (self-contained; no env deps)
# Verifies:
#   1) POST create (PUT /create, POST /signon)
#   2) GET exact by (svcconfigId, version, method, path)
#   3) PUT update minAccessLevel
# -----------------------------------------------------------------------------
set -euo pipefail
[ "${DEBUG:-0}" = "1" ] && set -x

# Base URL (CLI-style fallback is acceptable for smoke tooling)
SVCFACILITATOR_BASE_URL="${SVCFACILITATOR_BASE_URL:-http://127.0.0.1:4015}"
API="$SVCFACILITATOR_BASE_URL/api/svcfacilitator/v1"

# Generate a fresh 24-hex ObjectId for svcconfigId (portable)
gen_oid() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 12
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import os,binascii
print(binascii.hexlify(os.urandom(12)).decode())
PY
  else
    # Fallback: hash timestamp+pid; not cryptographically random but ok for tests
    (date +%s; echo $$; uname -a) | md5sum | awk '{print substr($1,1,24)}' 2>/dev/null || \
    (date +%s; echo $$; uname -a) | shasum | awk '{print substr($1,1,24)}'
  fi
}

SVCID="$(gen_oid)"
VER="1"

echo "→ Using svcconfigId=${SVCID} version=${VER}"

# Helpers
post_policy() {
  local method="$1" path="$2" min="$3"
  curl -sS -X POST "$API/routePolicy" \
    -H 'content-type: application/json' \
    -d "{\"svcconfigId\":\"$SVCID\",\"version\":$VER,\"method\":\"$method\",\"path\":\"$path\",\"minAccessLevel\":$min}"
}

get_policy() {
  local method="$1" path="$2"
  local url="$API/routePolicy?svcconfigId=$SVCID&version=$VER&method=$method&path=$(python3 - <<PY 2>/dev/null || echo $path
import urllib.parse,sys
print(urllib.parse.quote(sys.argv[1]))
PY "$path")"
  curl -sS "$url"
}

put_min() {
  local id="$1" min="$2"
  curl -sS -X PUT "$API/routePolicy/$id" \
    -H 'content-type: application/json' \
    -d "{\"id\":\"$id\",\"minAccessLevel\":$min}"
}

# 1) Create two policies
echo "→ POST create: PUT /create (min=0)"
RESP_CREATE="$(post_policy "PUT" "/create" 0)"
echo "$RESP_CREATE" | jq -e . >/dev/null 2>&1 || { echo "❌ Non-JSON from POST /create"; echo "$RESP_CREATE"; exit 1; }
echo "$RESP_CREATE" | jq -e 'select(.ok==true and .data.policy.method=="PUT" and .data.policy.path=="/create")' >/dev/null || {
  echo "❌ Unexpected POST /create response:"; echo "$RESP_CREATE" | jq .; exit 1; }
ID_CREATE="$(echo "$RESP_CREATE" | jq -r '.data.policy._id')"

echo "→ POST create: POST /signon (min=0)"
RESP_SIGNON="$(post_policy "POST" "/signon" 0)"
# Allow already-exists (409) scenario to be considered success by re-GETting
if ! echo "$RESP_SIGNON" | jq -e . >/dev/null 2>&1; then
  echo "❌ Non-JSON from POST /signon"; echo "$RESP_SIGNON"; exit 1;
fi
if [ "$(echo "$RESP_SIGNON" | jq -r '.ok')" != "true" ]; then
  STATUS="$(echo "$RESP_SIGNON" | jq -r '.data.status // empty')"
  if [ "$STATUS" = "conflict" ]; then
    echo "↪︎ POST /signon returned conflict; proceeding to GET"
  else
    echo "❌ POST /signon unexpected:"; echo "$RESP_SIGNON" | jq .; exit 1;
  fi
fi

# 2) GET both back
echo "→ GET exact: PUT /create"
RESP_GET_A="$(get_policy "PUT" "/create")"
echo "$RESP_GET_A" | jq -e '.ok==true and .data.policy!=null' >/dev/null || {
  echo "❌ Missing policy for PUT /create"; echo "$RESP_GET_A" | jq .; exit 1; }

echo "→ GET exact: POST /signon"
RESP_GET_B="$(get_policy "POST" "/signon")"
echo "$RESP_GET_B" | jq -e '.ok==true and .data.policy!=null' >/dev/null || {
  echo "❌ Missing policy for POST /signon"; echo "$RESP_GET_B" | jq .; exit 1; }
ID_SIGNON="$(echo "$RESP_GET_B" | jq -r '.data.policy._id')"

# 3) Update minAccessLevel on /create to 2, then verify
echo "→ PUT update minAccessLevel=2 on /create"
RESP_PUT="$(put_min "$ID_CREATE" 2)"
echo "$RESP_PUT" | jq -e '.ok==true and .data.policy.minAccessLevel==2' >/dev/null || {
  echo "❌ PUT update failed:"; echo "$RESP_PUT" | jq .; exit 1; }

# Final echo
echo "✅ OK: routePolicy CRUD self-contained"
echo "svcconfigId: $SVCID"
echo "createId:    $ID_CREATE"
echo "signonId:    $ID_SIGNON"
