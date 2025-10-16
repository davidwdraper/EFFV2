# scripts/smoke/smoke-011-facilitator-resolve.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 011: SvcFacilitator resolve(audit@v1) returns a complete, flat body
#
# Purpose:
#   Validate that the Facilitator returns a flat body with the composed data
#   needed to build service URLs (baseUrl, outboundApiPrefix, slug, version, etag).
#
# Preconditions:
#   - SVCFACILITATOR_BASE_URL is set (e.g., http://127.0.0.1:4015)  ← no defaults
#
# Canonical path:
#   GET /api/svcfacilitator/v1/resolve?slug=audit&version=1
#
# Docs:
#   - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
#   - ADRs:
#     - adr0020-svcconfig-mirror-and-push-design
#     - adr0007-svcconfig-contract-fixed-shapes
# =============================================================================

set -euo pipefail
if [ "${DEBUG:-0}" = "1" ]; then set -x; fi

# ---- Fail-fast envs (no defaults) -------------------------------------------
SVCFACILITATOR_BASE_URL=http://127.0.0.1:4015

: "${SVCFACILITATOR_BASE_URL:?SVCFACILITATOR_BASE_URL must be set}"

URL="${SVCFACILITATOR_BASE_URL}/api/svcfacilitator/v1/resolve?slug=audit&version=1"
echo "→ GET ${URL}"

RESP="$(curl -sS "${URL}")"

# ---- Basic JSON check -------------------------------------------------------
if ! echo "$RESP" | jq -e . >/dev/null 2>&1; then
  echo "❌ ERROR: Non-JSON response:"
  echo "$RESP"
  exit 1
fi

# ---- Envelope & body assertions --------------------------------------------
OK="$(echo "$RESP" | jq -r '.ok')"
SERVICE="$(echo "$RESP" | jq -r '.service')"
STATUS="$(echo "$RESP" | jq -r '.data.status')"

if [ "$OK" != "true" ] || [ "$SERVICE" != "svcfacilitator" ] || [ "$STATUS" != "200" ]; then
  echo "❌ ERROR: Unexpected envelope:"
  echo "$RESP" | jq .
  exit 1
fi

BODY="$(echo "$RESP" | jq '.data.body')"

# Required fields in the flat body
for key in baseUrl outboundApiPrefix slug version etag; do
  if [ "$(echo "$BODY" | jq -r ".${key} | type")" = "null" ]; then
    echo "❌ ERROR: Missing .data.body.${key}"
    echo "$RESP" | jq .
    exit 1
  fi
done

echo "✅ OK: Facilitator resolve returned a valid body:"
echo "$BODY" | jq .
