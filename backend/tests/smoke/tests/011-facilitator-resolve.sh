# backend/tests/smoke/tests/011-facilitator-resolve.sh
# -----------------------------------------------------------------------------
# Smoke 011: SvcFacilitator resolve(audit@v1) returns a complete, flat body
# Docs: SOP; ADRs: adr0020, adr0007, adr0033
# Change: expect `_id` (string) instead of legacy `etag`.
# -----------------------------------------------------------------------------
set -euo pipefail
[ "${DEBUG:-0}" = "1" ] && set -x

# Defaults (override via env)
SVCFACILITATOR_BASE_URL="${SVCFACILITATOR_BASE_URL:-http://127.0.0.1:4015}"

URL="${SVCFACILITATOR_BASE_URL}/api/svcfacilitator/v1/resolve?slug=audit&version=1"
echo "→ GET ${URL}"

RESP="$(curl -sS "${URL}")"
echo "$RESP" | jq -e . >/dev/null 2>&1 || { echo "❌ Non-JSON:"; echo "$RESP"; exit 1; }

OK="$(echo "$RESP" | jq -r '.ok')"
SERVICE="$(echo "$RESP" | jq -r '.service')"
STATUS="$(echo "$RESP" | jq -r '.data.status')"
[ "$OK" = "true" ] && [ "$SERVICE" = "svcfacilitator" ] && [ "$STATUS" = "200" ] || {
  echo "❌ Unexpected envelope:"; echo "$RESP" | jq .; exit 1; }

BODY="$(echo "$RESP" | jq '.data.body')"

# Required fields in the resolve body
for key in _id baseUrl outboundApiPrefix slug version; do
  TYPE="$(echo "$BODY" | jq -r ".${key} | type")"
  [ "$TYPE" != "null" ] || { echo "❌ Missing .data.body.${key}"; echo "$RESP" | jq .; exit 1; }
done

# Type checks for critical fields
ID_TYPE="$(echo "$BODY" | jq -r '._id | type')"
SLUG_TYPE="$(echo "$BODY" | jq -r '.slug | type')"
VER_TYPE="$(echo "$BODY" | jq -r '.version | type')"
URL_TYPE="$(echo "$BODY" | jq -r '.baseUrl | type')"
PFX_TYPE="$(echo "$BODY" | jq -r '.outboundApiPrefix | type')"

[ "$ID_TYPE" = "string" ] || { echo "❌ _id must be string"; echo "$RESP" | jq .; exit 1; }
[ "$SLUG_TYPE" = "string" ] || { echo "❌ slug must be string"; echo "$RESP" | jq .; exit 1; }
[ "$VER_TYPE" = "number" ] || { echo "❌ version must be number"; echo "$RESP" | jq .; exit 1; }
[ "$URL_TYPE" = "string" ] || { echo "❌ baseUrl must be string"; echo "$RESP" | jq .; exit 1; }
[ "$PFX_TYPE" = "string" ] || { echo "❌ outboundApiPrefix must be string"; echo "$RESP" | jq .; exit 1; }

echo "✅ OK: resolve body looks good"
echo "$BODY" | jq .
