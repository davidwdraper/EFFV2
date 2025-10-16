# scripts/smoke/smoke-012-audit-direct-ingress-envelope.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 012: Audit direct ingress → canonical envelope
#
# Purpose:
#   Bypass Gateway and POST to Audit directly with the AuditEntries v1 contract.
#   Assert the standard response envelope and that the handler returns accepted>=1.
#
# Preconditions:
#   - AUDIT_BASE_URL is set (e.g., http://127.0.0.1:4050)  ← no defaults
#   - Audit service running and listening
#
# Canonical path:
#   POST /api/audit/v1/entries
#
# Docs:
#   - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
#   - ADRs:
#     - adr0022-shared-wal-and-db-base
#     - adr0024-audit-wal-persistence-guarantee
# =============================================================================

set -euo pipefail
if [ "${DEBUG:-0}" = "1" ]; then set -x; fi

AUDIT_BASE_URL=http://127.0.0.1:4050
: "${AUDIT_BASE_URL:?AUDIT_BASE_URL must be set}"

URL="${AUDIT_BASE_URL}/api/audit/v1/entries"

RID="smoke-012-$(date +%s)"
NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
END_MS="$(node -e "process.stdout.write(String(${NOW_MS}+111))")"

echo "→ POST ${URL}"

PAYLOAD=$(cat <<EOF
{
  "entries": [
    {
      "meta": { "requestId": "${RID}", "service": "gateway", "ts": ${NOW_MS} },
      "blob": {
        "target": { "slug": "act", "version": 1, "route": "/api/acts", "method": "PUT" },
        "phase": "begin",
        "smoke": 12,
        "note": "begin"
      }
    },
    {
      "meta": { "requestId": "${RID}", "service": "gateway", "ts": ${END_MS} },
      "blob": {
        "target": { "slug": "act", "version": 1, "route": "/api/acts", "method": "PUT" },
        "phase": "end",
        "status": "ok",
        "httpCode": 200,
        "smoke": 12,
        "note": "end"
      }
    }
  ]
}
EOF
)

RESP="$(curl -sS \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'X-NV-Contract: audit/entries@v1' \
  -X POST --data "${PAYLOAD}" "${URL}")"

# JSON check
if ! echo "$RESP" | jq -e . >/dev/null 2>&1; then
  echo "❌ ERROR: Non-JSON response:"
  echo "$RESP"
  exit 1
fi

# Envelope assertions (canonical: data = { status, body })
OK="$(echo "$RESP" | jq -r '.ok')"
SERVICE="$(echo "$RESP" | jq -r '.service')"
STATUS="$(echo "$RESP" | jq -r '.data.status')"
ACCEPTED="$(echo "$RESP" | jq -r '.data.body.accepted')"

if [ "$OK" != "true" ] || [ "$SERVICE" != "audit" ] || [ "$STATUS" != "200" ] || [ "$ACCEPTED" -lt 1 ]; then
  echo "❌ ERROR: Unexpected envelope/body:"
  echo "$RESP" | jq .
  exit 1
fi

echo "✅ OK: $SERVICE accepted=${ACCEPTED} requestId=${RID}"
