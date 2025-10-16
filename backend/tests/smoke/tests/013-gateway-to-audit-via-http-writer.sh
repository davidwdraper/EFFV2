# scripts/smoke/smoke-013-gateway-httpwriter-e2e.sh
#!/usr/bin/env bash
# =============================================================================
# Smoke 013: Gateway → (proxy) → Service, with Gateway auditing via HttpAuditWriter
#
# Purpose:
#   Prove the full path: client → GATEWAY → target service, while the Gateway
#   audits (begin/end) via its WAL and HttpAuditWriter to the Audit service.
#
# Strategy:
#   - Hit a legitimate Gateway API (defaults to proxying Audit /entries).
#   - Provide X-NV-Contract required by the target.
#   - Set X-Request-Id = RID so we can confirm DB entries for that RID.
#   - Assert canonical envelope on the response (from the target service).
#   - Optionally verify Mongo persistence for RID (>=2 docs).
#
# Dev defaults (override via env):
#   DEV_HOST               default 127.0.0.1
#   GATEWAY_PORT           default 4000
#   TARGET_SLUG            default audit
#   TARGET_VERSION         default 1
#   TARGET_PATH            default /entries
#   TARGET_METHOD          default POST
#   TARGET_CONTRACT        default audit/entries@v1
#   AUDIT_DB_URI/NAME/COLLECTION (optional; enables DB verify when mongosh present)
#   WAL_FLUSH_MS or AUDIT_WAL_FLUSH_MS to wait between request and DB check
#
# Docs:
#   - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
#   - ADRs: adr0022, adr0024, adr0025, adr0026
# =============================================================================
set -euo pipefail
if [ "${DEBUG:-0}" = "1" ]; then set -x; fi

# --- Dev defaults -------------------------------------------------------------
DEV_HOST="${DEV_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-4000}"
GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://${DEV_HOST}:${GATEWAY_PORT}}"

TARGET_SLUG="${TARGET_SLUG:-audit}"
TARGET_VERSION="${TARGET_VERSION:-1}"
TARGET_PATH="${TARGET_PATH:-/entries}"     # service-local path (after /v1)
TARGET_METHOD="${TARGET_METHOD:-POST}"
TARGET_CONTRACT="${TARGET_CONTRACT:-audit/entries@v1}"

URL="${GATEWAY_BASE_URL}/api/${TARGET_SLUG}/v${TARGET_VERSION}${TARGET_PATH}"

RID="smoke-013-$(date +%s)"
NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
END_MS="$(node -e "process.stdout.write(String(${NOW_MS}+222))")"

echo "→ ${TARGET_METHOD} ${URL} (rid=${RID})"

# --- Default payload (works for audit/entries; harmless for other services if overridden) ---
PAYLOAD="${PAYLOAD_OVERRIDE:-}"
if [ -z "${PAYLOAD}" ]; then
  PAYLOAD=$(cat <<EOF
{
  "entries": [
    {
      "meta": { "requestId": "${RID}", "service": "gateway", "ts": ${NOW_MS} },
      "blob": {
        "target": { "slug": "act", "version": 1, "route": "/api/acts", "method": "PUT" },
        "phase": "begin",
        "smoke": 13,
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
        "smoke": 13,
        "note": "end"
      }
    }
  ]
}
EOF
)
fi

# --- Fire request through Gateway -------------------------------------------
RESP="$(curl -sS \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: ${RID}" \
  -H "X-NV-Contract: ${TARGET_CONTRACT}" \
  -X "${TARGET_METHOD}" --data "${PAYLOAD}" "${URL}")"

# --- JSON check --------------------------------------------------------------
if ! echo "$RESP" | jq -e . >/dev/null 2>&1; then
  echo "❌ ERROR: Non-JSON response:"
  echo "$RESP"
  exit 1
fi

# --- Envelope assertions (target service should respond with canonical envelope) ------------
OK="$(echo "$RESP" | jq -r '.ok')"
SERVICE="$(echo "$RESP" | jq -r '.service')"
STATUS="$(echo "$RESP" | jq -r '.data.status')"

if [ "$OK" != "true" ] || [ "$STATUS" != "200" ]; then
  echo "❌ ERROR: Unexpected envelope from target service:"
  echo "$RESP" | jq .
  exit 1
fi

echo "✅ OK: gateway proxied to service=${SERVICE} status=${STATUS} rid=${RID}"

# --- Optional DB verify: ensure Audit received >=2 docs for this RID -----------------------
MONGO_URI="${MONGO_URI:-${AUDIT_DB_URI:-}}"
MONGO_DB="${MONGO_DB:-${AUDIT_DB_NAME:-}}"
MONGO_COLL="${MONGO_COLL:-${AUDIT_DB_COLLECTION:-}}"

if command -v mongosh >/dev/null 2>&1 && [ -n "${MONGO_URI}" ] && [ -n "${MONGO_DB}" ] && [ -n "${MONGO_COLL}" ]; then
  # Give the Gateway WAL flush + HttpAuditWriter a moment
  SLEEP_MS="${AUDIT_WAL_FLUSH_MS:-${WAL_FLUSH_MS:-1000}}"
  node -e "setTimeout(()=>{}, ${SLEEP_MS})"

  COUNT="$(mongosh "${MONGO_URI}/${MONGO_DB}" --quiet --eval \
    "db.getSiblingDB('${MONGO_DB}').${MONGO_COLL}.countDocuments({ 'meta.requestId': '${RID}' })")" || COUNT="0"

  if [ "${COUNT}" -lt 2 ]; then
    echo "❌ ERROR: DB verify failed — expected >=2 audit docs for requestId=${RID}, found ${COUNT}"
    exit 1
  fi
  echo "✅ DB verify: ${COUNT} audit docs persisted for requestId=${RID}"
else
  echo "ℹ️  Skipping DB verify (mongosh or MONGO envs not set)."
fi
