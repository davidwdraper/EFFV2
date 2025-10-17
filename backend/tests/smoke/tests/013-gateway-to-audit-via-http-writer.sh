# scripts/smoke/smoke-013-gateway-httpwriter-e2e.sh
#!/usr/bin/env bash
# repo-path: scripts/smoke/smoke-013-gateway-httpwriter-e2e.sh
# -----------------------------------------------------------------------------
# Smoke 013: Gateway → target (proxy), Gateway audits via WAL+HttpAuditWriter
# Docs: SOP; ADRs: adr0022, adr0024, adr0025, adr0026
# -----------------------------------------------------------------------------
set -euo pipefail
[ "${DEBUG:-0}" = "1" ] && set -x

GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://127.0.0.1:4000}"
TARGET_SLUG="${TARGET_SLUG:-audit}"
TARGET_VERSION="${TARGET_VERSION:-1}"
TARGET_PATH="${TARGET_PATH:-/entries}"     # service-local after /v1
TARGET_METHOD="${TARGET_METHOD:-POST}"
TARGET_CONTRACT="${TARGET_CONTRACT:-audit/entries@v1}"
WAL_FLUSH_MS_DEFAULT="${AUDIT_WAL_FLUSH_MS:-${WAL_FLUSH_MS:-1000}}"

URL="${GATEWAY_BASE_URL}/api/${TARGET_SLUG}/v${TARGET_VERSION}${TARGET_PATH}"

RID="smoke-013-$(date +%s)"
NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
END_MS="$(node -e "process.stdout.write(String(${NOW_MS}+222))")"

echo "→ ${TARGET_METHOD} ${URL} (rid=${RID})"

# Contract-legal payload: no extra keys under blob
PAYLOAD="${PAYLOAD_OVERRIDE:-}"
if [ -z "${PAYLOAD}" ]; then
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
fi

RESP="$(curl -sS \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: ${RID}" \
  -H "X-NV-Contract: ${TARGET_CONTRACT}" \
  -X "${TARGET_METHOD}" --data "${PAYLOAD}" "${URL}")"

echo "$RESP" | jq -e . >/dev/null 2>&1 || { echo "❌ Non-JSON:"; echo "$RESP"; exit 1; }

OK="$(echo "$RESP" | jq -r '.ok')"
SERVICE="$(echo "$RESP" | jq -r '.service')"
STATUS="$(echo "$RESP" | jq -r '.data.status')"

if [ "$OK" != "true" ] || [ "$STATUS" != "200" ]; then
  echo "❌ Unexpected envelope from target:"; echo "$RESP" | jq .; exit 1
fi

echo "✅ OK: gateway proxied to service=${SERVICE} status=${STATUS} rid=${RID}"

# Optional DB verify (same as before)
MONGO_URI="${MONGO_URI:-${AUDIT_DB_URI:-}}"
MONGO_DB="${MONGO_DB:-${AUDIT_DB_NAME:-}}"
MONGO_COLL="${MONGO_COLL:-${AUDIT_DB_COLLECTION:-}}"

if command -v mongosh >/dev/null 2>&1 && [ -n "${MONGO_URI}" ] && [ -n "${MONGO_DB}" ] && [ -n "${MONGO_COLL}" ]; then
  node -e "setTimeout(()=>{}, ${WAL_FLUSH_MS_DEFAULT})"
  COUNT="$(mongosh "${MONGO_URI}/${MONGO_DB}" --quiet --eval \
    "db.getSiblingDB('${MONGO_DB}').${MONGO_COLL}.countDocuments({ 'meta.requestId': '${RID}' })")" || COUNT="0"
  if [ "${COUNT}" -lt 2 ]; then
    echo "❌ DB verify failed — expected >=2 audit docs for requestId=${RID}, found ${COUNT}"; exit 1
  fi
  echo "✅ DB verify: ${COUNT} audit docs persisted for requestId=${RID}"
else
  echo "ℹ️  Skipping DB verify (mongosh or MONGO_* not set)"
fi
