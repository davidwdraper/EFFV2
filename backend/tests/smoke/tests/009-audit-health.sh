#!/usr/bin/env bash
# ============================================================================
# Smoke: Audit service health
# Requires service to be running on PORT=4050
# Canonical path: /api/audit/v1/health/live
# macOS bash 3.2 compatible
# Docs:
# - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
# - ADRs:
#   - adr0022-shared-wal-and-db-base
# ============================================================================
set -euo pipefail

URL="http://127.0.0.1:4050/api/audit/v1/health/live"

# Always show exactly what we're hitting
echo "→ GET ${URL}"

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

if [ "$STATUS" != "live" ] || [ "$SERVICE" != "audit" ]; then
  echo "ERROR: Unexpected payload:"
  echo "$RESP" | jq .
  exit 1
fi

echo "OK: $SERVICE is $STATUS"
