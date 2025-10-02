# backend/tests/smoke/tests/005-auth-health-via-gateway.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke: Auth v1 via Gateway (versioned path)
# Requires: gateway :4000, auth :4010
# Path: /api/auth/health/live (proxied)
# macOS bash 3.2 compatible
# ============================================================================
set -euo pipefail

URL="http://127.0.0.1:4000/api/auth/health/live"

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

if [ "$STATUS" != "live" ] || [ "$SERVICE" != "auth" ]; then
  echo "ERROR: Unexpected payload (expecting service=auth & status=live):"
  echo "$RESP" | jq .
  exit 1
fi

echo "OK: gateway→auth v1 (versioned) works"
