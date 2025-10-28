# backend/tests/smoke/tests/007-svcfacilitator-health-via-gateway.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke: SvcFacilitator v1 via Gateway (versioned path)
# Requires: gateway :4000, svcfacilitator :4015
# Path: /api/svcfacilitator/v1/health/live (proxied)
# macOS bash 3.2 compatible
# Docs:
# - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
# - ADRs: docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
# ============================================================================

set -euo pipefail

URL="http://127.0.0.1:4000/api/svcfacilitator/v1/health/live"

# Always show exactly what we're hitting
echo "→ GET ${URL}"

RESP="$(curl -sS -H 'Accept: application/json' "$URL" || true)"

if [ -z "${RESP}" ]; then
  echo "ERROR: Empty response from $URL"
  exit 1
fi

if ! echo "$RESP" | jq -e . >/dev/null 2>&1; then
  echo "ERROR: Non-JSON response from $URL:"
  echo "$RESP"
  exit 1
fi

STATUS="$(echo "$RESP" | jq -r '.data.status')"
SERVICE="$(echo "$RESP" | jq -r '.service')"

if [ "$STATUS" != "live" ] || [ "$SERVICE" != "svcfacilitator" ]; then
  echo "ERROR: Unexpected payload (expecting service=svcfacilitator & status=live):"
  echo "$RESP" | jq .
  exit 1
fi

echo "OK: gateway→svcfacilitator v1 (versioned) works"
