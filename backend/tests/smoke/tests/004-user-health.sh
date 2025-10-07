# backend/tests/smoke/tests/004-user-health.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke: User v1 health (direct)
# Requires: user :4020
# Path: /api/user/v1/health/live
# macOS bash 3.2 compatible
# ============================================================================
set -euo pipefail

URL="http://127.0.0.1:4020/api/user/v1/health/live"

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

if [ "$STATUS" != "live" ] || [ "$SERVICE" != "user" ]; then
  echo "ERROR: Unexpected payload (expecting service=user & status=live):"
  echo "$RESP" | jq .
  exit 1
fi

echo "OK: user health v1 direct"
