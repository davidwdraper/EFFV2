#!/usr/bin/env bash
# NowVibin smoke test 18 — Audit batch ingest (direct, PUT /api/events)

t18() {
  local AUD_BASE="${AUDIT:-http://127.0.0.1:4999}"
  local url="${AUD_BASE}/api/events"

  # Build headers safely (no word-splitting)
  local S2S; S2S=$(TOKEN_CORE)
  local ASSERT; ASSERT=$(ASSERT_USER smoke-tests 300)
  local H1="Authorization: Bearer ${S2S}"
  local H2="X-NV-User-Assertion: ${ASSERT}"

  # Unique ids
  local now; now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local ridA ridB eidA eidB
  ridA=$(openssl rand -hex 12 2>/dev/null || echo "ridA-$$-$(date +%s)")
  ridB=$(openssl rand -hex 12 2>/dev/null || echo "ridB-$$-$(date +%s)")
  eidA="smoke-18-$(date +%s)-a"
  eidB="smoke-18-$(date +%s)-b"

  # Payload matches validator (finish|timeout|client-abort|shutdown-replay)
  local payload
  payload=$(json "[
    {
      \"eventId\": \"${eidA}\",
      \"requestId\": \"${ridA}\",
      \"ts\": \"${now}\",
      \"method\": \"PUT\",
      \"path\": \"/api/acts\",
      \"slug\": \"act\",
      \"status\": 200,
      \"durationMs\": 123,
      \"finalizeReason\": \"finish\",
      \"source\": { \"service\": \"gateway\", \"instanceId\": \"smoke-runner\", \"s2sIssuer\": \"gateway-core\", \"s2sSubject\": \"gateway-core\", \"ip\": \"127.0.0.1\", \"userAgent\": \"nv-smoke/1.0\" },
      \"billing\": { \"billingAccountId\": \"acct_smoke_18\", \"planId\": \"TEST\", \"meterId\": \"api.smoke\", \"meterQty\": 1, \"meterUnit\": \"call\", \"billableUnits\": 1 }
    },
    {
      \"eventId\": \"${eidB}\",
      \"requestId\": \"${ridB}\",
      \"ts\": \"${now}\",
      \"method\": \"GET\",
      \"path\": \"/api/acts/xyz\",
      \"slug\": \"act\",
      \"status\": 200,
      \"durationMs\": 456,
      \"finalizeReason\": \"finish\",
      \"source\": { \"service\": \"gateway\", \"instanceId\": \"smoke-runner\", \"s2sIssuer\": \"gateway-core\", \"s2sSubject\": \"gateway-core\", \"ip\": \"127.0.0.1\", \"userAgent\": \"nv-smoke/1.0\" },
      \"billing\": { \"billingAccountId\": \"acct_smoke_18\", \"planId\": \"TEST\", \"meterId\": \"api.smoke\", \"meterQty\": 1, \"meterUnit\": \"call\", \"billableUnits\": 1 }
    }
  ]")

  echo "→ PUT $url"
  local resp
  resp=$(curl -sS -X PUT "$url" \
    -H "$H1" \
    -H "$H2" \
    -H "Content-Type: application/json" \
    -d "$payload") || { echo "❌ curl failed"; exit 1; }
  echo "$resp" | pretty

  # Accept either {accepted:2} or {received:2}
  local accepted=""
  if [[ ${NV_USE_JQ:-1} -eq 1 ]] && command -v ${JQ:-jq} >/dev/null 2>&1; then
    accepted=$(echo "$resp" | ${JQ:-jq} -r '.accepted // .received // empty')
  fi
  if [[ -z "$accepted" ]]; then
    accepted=$(echo "$resp" | sed -nE 's/.*"accepted"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p')
    [[ -n "$accepted" ]] || accepted=$(echo "$resp" | sed -nE 's/.*"received"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p')
  fi

  [[ "$accepted" == "2" ]] || { echo "❌ expected 2 accepted/received, got '$accepted'"; exit 1; }
  echo "✅ batch accepted $accepted events"
}
register_test 18 "audit PUT /api/events batch (direct 4999) [JWT core]" t18
