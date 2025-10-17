# scripts/smoke/smoke-011-facilitator-resolve.sh
# -----------------------------------------------------------------------------
# Smoke 011: SvcFacilitator resolve(audit@v1) returns a complete, flat body
# Docs: SOP; ADRs: adr0020, adr0007
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
for key in baseUrl outboundApiPrefix slug version etag; do
  TYPE="$(echo "$BODY" | jq -r ".${key} | type")"
  [ "$TYPE" != "null" ] || { echo "❌ Missing .data.body.${key}"; echo "$RESP" | jq .; exit 1; }
done

echo "✅ OK: resolve body looks good"
echo "$BODY" | jq .
