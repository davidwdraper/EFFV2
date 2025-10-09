#!/usr/bin/env bash
# ============================================================================
# Smoke 010: Audit direct ingest → WAL → flusher → Mongo
# Requires:
#   - Audit service running on PORT=4050
#   - AUDIT_DB_* env set (URI/NAME/COLLECTION)
#   - Flusher active (AuditApp starts AuditWalFlusher)
# Canonical path: POST /api/audit/v1/entries
# macOS bash 3.2 compatible
# Docs:
# - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
# - ADRs:
#   - adr0022-shared-wal-and-db-base
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

# Build JSON with variable expansion (no tricky post-substitution)
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
      "http": { "code": 200 },
      "meta": { "smoke": 10, "note": "end" }
    }
  ]
}
EOF
)

# Fire request
RESP="$(curl -sS -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -X POST --data "${PAYLOAD}" "${URL}" || true)"

# Bail if empty
if [ -z "${RESP}" ]; then
  echo "ERROR: Empty response from ${URL}"
  exit 1
fi

# Ensure JSON
if ! echo "$RESP" | jq -e . >/dev/null 2>&1; then
  echo "ERROR: Non-JSON response from ${URL}:"
  echo "$RESP"
  exit 1
fi

# Assert canonical envelope
OK="$(echo "$RESP" | jq -r '.ok')"
SERVICE="$(echo "$RESP" | jq -r '.service')"
ACCEPTED="$(echo "$RESP" | jq -r '.data.accepted')"

if [ "$OK" != "true" ] || [ "$SERVICE" != "audit" ] || [ "$ACCEPTED" != "2" ]; then
  echo "ERROR: Unexpected payload:"
  echo "$RESP" | jq .
  exit 1
fi

echo "OK: $SERVICE accepted=$ACCEPTED requestId=${RID}"

# Give the flusher a beat to persist (optional)
SLEEP_MS="${AUDIT_WAL_FLUSH_MS:-${WAL_FLUSH_MS:-1000}}"
node -e "setTimeout(()=>{}, ${SLEEP_MS})"
