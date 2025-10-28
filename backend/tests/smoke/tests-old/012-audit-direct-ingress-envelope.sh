# scripts/smoke/smoke-012-audit-direct-ingress-envelope.sh
#!/usr/bin/env bash
# repo-path: scripts/smoke/smoke-012-audit-direct-ingress-envelope.sh
# -----------------------------------------------------------------------------
# Smoke 012: Audit direct ingress → canonical envelope (contract-legal only)
# Docs: SOP; ADRs: adr0022, adr0024
# -----------------------------------------------------------------------------
set -euo pipefail
[ "${DEBUG:-0}" = "1" ] && set -x

AUDIT_BASE_URL="${AUDIT_BASE_URL:-http://127.0.0.1:4050}"
URL="${AUDIT_BASE_URL}/api/audit/v1/entries"

RID="smoke-012-$(date +%s)"
NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
END_MS="$(node -e "process.stdout.write(String(${NOW_MS}+111))")"

# Contract-legal payload: no extra keys under blob
PAYLOAD=$(cat <<EOF
{
  "entries": [
    {
      "meta": { "requestId": "${RID}", "service": "gateway", "ts": ${NOW_MS} },
      "blob": {
        "target": { "slug": "act", "version": 1, "route": "/api/acts", "method": "PUT" },
        "phase": "begin"
      }
    },
    {
      "meta": { "requestId": "${RID}", "service": "gateway", "ts": ${END_MS} },
      "blob": {
        "target": { "slug": "act", "version": 1, "route": "/api/acts", "method": "PUT" },
        "phase": "end",
        "status": "ok",
        "httpCode": 200
      }
    }
  ]
}
EOF
)

echo "→ POST ${URL}"
echo "— payload to be sent —"
echo "${PAYLOAD}" | jq .

# Hard guard: fail if any "smoke" key exists in the payload
if echo "${PAYLOAD}" | jq -e '.. | objects | has("smoke")' >/dev/null 2>&1; then
  echo "❌ Guard: payload contains forbidden key \"smoke\". Fix the script content."
  exit 1
fi

RESP="$(curl -sS \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'X-NV-Contract: audit/entries@v1' \
  -X POST --data "${PAYLOAD}" "${URL}")"

# JSON check
echo "$RESP" | jq -e . >/dev/null 2>&1 || { echo "❌ Non-JSON response:"; echo "$RESP"; exit 1; }

# Envelope assertions
OK="$(echo "$RESP" | jq -r '.ok')"
SERVICE="$(echo "$RESP" | jq -r '.service')"
STATUS="$(echo "$RESP" | jq -r '.data.status')"
ACCEPTED="$(echo "$RESP" | jq -r '.data.body.accepted')"

if [ "$OK" != "true" ] || [ "$SERVICE" != "audit" ] || [ "$STATUS" != "200" ] || [ "$ACCEPTED" -lt 1 ]; then
  echo "❌ Unexpected envelope/body:"
  echo "$RESP" | jq .
  exit 1
fi

echo "✅ OK: $SERVICE accepted=${ACCEPTED} requestId=${RID}"
