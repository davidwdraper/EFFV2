# scripts/smoke/tests/018_audit_batch_direct.sh

# t18 — audit PUT /api/events batch (direct 4999) [S2S]
t18() {
  # Be strict but don't die on unset env; we provide sane defaults.
  set -eo pipefail

  # Defaults if the harness didn't set them
  local BASE="${BASE:-http://127.0.0.1:4999}"
  local AUTHZ="${AUTHZ:-}"       # e.g., "Authorization: Bearer <token>"
  local PAY="${PAY:-}"           # optional; if empty we'll synthesize

  local HDR OUT HTTP COUNT
  HDR="$(mktemp)"; OUT="$(mktemp)"
  trap 'rm -f "$HDR" "$OUT" ${TMP_PAY:-}' RETURN

  # If no payload provided, synthesize 2 valid events
  if [ -z "$PAY" ]; then
    TMP_PAY="$(mktemp)"
    # 2 simple, valid events; ids include time to avoid dup collisions
    local T NOW
    NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    T="$(date +%s)"
    cat >"$TMP_PAY" <<JSON
[
  {
    "eventId": "smoke-18-${T}-a",
    "ts": "${NOW}",
    "durationMs": 123,
    "finalizeReason": "finish",
    "requestId": "r-${T}-a",
    "method": "PUT",
    "path": "/api/acts",
    "slug": "act",
    "status": 200,
    "billableUnits": 1
  },
  {
    "eventId": "smoke-18-${T}-b",
    "ts": "${NOW}",
    "durationMs": 456,
    "finalizeReason": "finish",
    "requestId": "r-${T}-b",
    "method": "GET",
    "path": "/api/acts/xyz",
    "slug": "act",
    "status": 200,
    "billableUnits": 1
  }
]
JSON
    PAY="$TMP_PAY"
  fi

  # Optional auth header
  local CURL_AUTH=()
  if [ -n "$AUTHZ" ]; then
    CURL_AUTH=(-H "$AUTHZ")
  fi

  HTTP="$(curl -sS -i -o "$OUT" -D "$HDR" -w '%{http_code}' \
    -X PUT "$BASE/api/events" \
    "${CURL_AUTH[@]}" \
    -H 'Content-Type: application/json' \
    --data-binary @"$PAY")" || HTTP="000"

  echo "→ PUT $BASE/api/events"

  # Prefer header; fallback to JSON body
  COUNT="$(grep -i '^X-Audit-Received:' "$HDR" 2>/dev/null | awk '{print $2}' | tr -d '\r')"
  if [ -z "${COUNT:-}" ] || ! echo "$COUNT" | grep -Eq '^[0-9]+$'; then
    COUNT="$(jq -r '.received // empty' "$OUT" 2>/dev/null || true)"
  fi

  if [ "$HTTP" != "202" ]; then
    echo "❌ expected HTTP 202, got $HTTP"
    return 1
  fi

  if [ "$COUNT" != "2" ]; then
    echo "❌ expected 2 accepted/received, got '$COUNT'"
    echo "--- Response headers ---"
    cat "$HDR"
    echo "--- Response body ---"
    cat "$OUT"
    return 1
  fi

  echo "✅ received $COUNT"
  return 0
}

# Register exactly like the other tests
register_test 18 "audit PUT /api/events batch (direct 4999) [S2S]" t18
