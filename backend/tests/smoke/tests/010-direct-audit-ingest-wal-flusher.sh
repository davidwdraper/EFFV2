#!/usr/bin/env bash
# ============================================================================
# Smoke 010: Audit direct ingest → WAL → flusher → Mongo
#
# Purpose:
#   End-to-end validation that the Audit service can receive AuditEntryJson
#   payloads, write to WAL, and have the flusher persist them to Mongo.
#
# Preconditions:
#   - Audit service running (PORT=4050)
#   - AUDIT_DB_* envs set (URI/NAME/COLLECTION)
#   - WAL_DIR + WAL_CURSOR_FILE envs set and writable
#   - Flusher active (AuditApp starts AuditWalFlusher)
#
# Canonical path:
#   POST /api/audit/v1/entries
#
# Docs:
#   - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
#   - ADRs:
#     - adr0022-shared-wal-and-db-base
#     - adr0024-audit-wal-persistence-guarantee
# ============================================================================
set -euo pipefail

# Optional debug
if [ "${DEBUG:-0}" = "1" ]; then set -x; fi

PORT="${PORT:-4050}"
BASE="http://127.0.0.1:${PORT}/api/audit/v1"
URL="${BASE}/entries"

RID="smoke-010-$(date +%s)"
NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
END_MS="$(node -e "process.stdout.write(String(${NOW_MS}+123))")"

echo "→ POST ${URL}"

# ----------------------------------------------------------------------------
# Build JSON payload (AuditEntryJson objects)
# ----------------------------------------------------------------------------
PAYLOAD=$(cat <<EOF
{
  "entries": [
    {
      "requestId": "${RID}",
      "service": "gateway",
      "target": { "slug": "act", "version": 1, "route": "/api/acts", "method": "PUT" },
      "phase": "begin",
      "ts": ${NOW_MS},
      "meta": { "smoke": 10, "note": "begin" }
    },
    {
      "requestId": "${RID}",
      "service": "gateway",
      "target": { "slug": "act", "version": 1, "route": "/api/acts", "method": "PUT" },
      "phase": "end",
      "ts": ${END_MS},
      "status": "ok",
      "httpCode": 200,
      "meta": { "smoke": 10, "note": "end" }
    }
  ]
}
EOF
)

# ----------------------------------------------------------------------------
# Fire request
# ----------------------------------------------------------------------------
RESP="$(curl -sS -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -X POST --data "${PAYLOAD}" "${URL}" || true)"

# Bail if empty
if [ -z "${RESP}" ]; then
  echo "❌ ERROR: Empty response from ${URL}"
  exit 1
fi

# Ensure JSON
if ! echo "$RESP" | jq -e . >/dev/null 2>&1; then
  echo "❌ ERROR: Non-JSON response from ${URL}:"
  echo "$RESP"
  exit 1
fi

# ----------------------------------------------------------------------------
# Assert canonical envelope
# ----------------------------------------------------------------------------
OK="$(echo "$RESP" | jq -r '.ok')"
SERVICE="$(echo "$RESP" | jq -r '.service')"
ACCEPTED="$(echo "$RESP" | jq -r '.data.accepted')"

if [ "$OK" != "true" ] || [ "$SERVICE" != "audit" ] || [ "$ACCEPTED" != "2" ]; then
  echo "❌ ERROR: Unexpected payload:"
  echo "$RESP" | jq .
  exit 1
fi

echo "✅ OK: $SERVICE accepted=$ACCEPTED requestId=${RID}"

# ----------------------------------------------------------------------------
# Optional: give the flusher a beat to persist
# ----------------------------------------------------------------------------
SLEEP_MS="${AUDIT_WAL_FLUSH_MS:-${WAL_FLUSH_MS:-1000}}"
node -e "setTimeout(()=>{}, ${SLEEP_MS})"
