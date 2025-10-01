#!/usr/bin/env bash
# ============================================================================
# Smoke: Gateway health
# Requires service to be running on PORT=4000
# Canonical path: /api/gateway/health/live
# macOS bash 3.2 compatible
# Docs:
# - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
# - ADRs:
#   - docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
# ============================================================================
set -euo pipefail

URL="http://127.0.0.1:4000/api/gateway/health/live"

# Ask for JSON only; don't include headers in the jq stream
RESP="$(curl -sS -H 'Accept: application/json' "$URL" || true)"

# If empty, fail with context
if [ -z "${RESP}" ]; then
  echo "ERROR: Empty response from $URL"
  exit 1
fi

# Try to parse as JSON; if jq fails, show raw response and bail
if ! echo "$RESP" | jq -e . >/dev/null 2>&1; then
  echo "ERROR: Non-JSON response from $URL:"
  echo "$RESP"
  exit 1
fi

# Assert expected envelope
STATUS="$(echo "$RESP" | jq -r '.data.status')"
SERVICE="$(echo "$RESP" | jq -r '.service')"

if [ "$STATUS" != "live" ] || [ "$SERVICE" != "gateway" ]; then
  echo "ERROR: Unexpected payload:"
  echo "$RESP" | jq .
  exit 1
fi

echo "OK: $SERVICE is $STATUS"
