# scripts/smoke/smoke-010-audit-direct-ingest-wal-to-mongo.sh
#!/usr/bin/env bash
# repo-path: scripts/smoke/smoke-010-audit-direct-ingest-wal-to-mongo.sh
# -----------------------------------------------------------------------------
# Smoke 010: Audit direct ingest → WAL → flusher → Mongo
# Docs: SOP; ADRs: adr0022, adr0024, adr0026
# -----------------------------------------------------------------------------
set -euo pipefail
[ "${DEBUG:-0}" = "1" ] && set -x

# Defaults (override via env)
AUDIT_BASE_URL="${AUDIT_BASE_URL:-http://127.0.0.1:4050}"
WAL_FLUSH_MS_DEFAULT="${AUDIT_WAL_FLUSH_MS:-${WAL_FLUSH_MS:-1000}}"

URL="${AUDIT_BASE_URL}/api/audit/v1/entries"

RID="smoke-010-$(date +%s)"
NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
END_MS="$(node -e "process.stdout.write(String(${NOW_MS}+123))")"

echo "→ POST ${URL}"

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

RESP="$(curl -sS \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H 'X-NV-Contract: audit/entries@v1' \
  -X POST --data "${PAYLOAD}" "${URL}" || true)"

[ -n "${RESP}" ] || { echo "❌ Empty response from ${URL}"; exit 1; }
echo "$RESP" | jq -e . >/dev/null 2>&1 || { echo "❌ Non-JSON:"; echo "$RESP"; exit 1; }

OK="$(echo "$RESP" | jq -r '.ok')"
SERVICE="$(echo "$RESP" | jq -r '.service')"
STATUS="$(echo "$RESP" | jq -r '.data.status')"
ACCEPTED="$(echo "$RESP" | jq -r '.data.body.accepted')"

if [ "$OK" != "true" ] || [ "$SERVICE" != "audit" ] || [ "$STATUS" != "200" ] || [ "$ACCEPTED" != "2" ]; then
  echo "❌ Unexpected payload:"; echo "$RESP" | jq .; exit 1
fi

echo "✅ OK: $SERVICE accepted=$ACCEPTED requestId=${RID}"
node -e "setTimeout(()=>{}, ${WAL_FLUSH_MS_DEFAULT})"
