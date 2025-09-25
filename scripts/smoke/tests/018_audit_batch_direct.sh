#!/usr/bin/env bash
# NowVibin — Smoke Tests
# Test: 018 — GATEWAY EDGE must REJECT PUT /api/audit/events (security)
#
# WHY:
# - The public edge must never allow direct writes to the audit worker.
# - This test intentionally hits the edge and expects a 401/403/404.
#
# Notes:
# - Fixes earlier bug: headers must be expanded as an array, NOT via $( ... ).
# - We send proper client headers, including X-NV-User-Assertion, to prove that
#   even with valid edge auth, the route itself is not exposed.

t18() {
  local url="${GW%/}/api/audit/events"

  # Edge client headers (sets NV_CLIENT_HEADERS array)
  AUTH_HEADERS_CLIENT_ARR

  echo "→ (SECURITY) PUT ${url} — expect 401/403/404"
  local HTTP
  HTTP="$(curl -sS -o /dev/null -w '%{http_code}' \
    --connect-timeout 3 --max-time 8 --http1.1 \
    -X PUT "$url" \
    "${NV_CLIENT_HEADERS[@]}" \
    -H 'Accept: application/json' \
    -H 'Content-Type: application/x-ndjson' \
    -H 'Expect:' \
    --data-binary $'{"noop":"security-test"}\n' \
  )" || HTTP="000"

  case "$HTTP" in
    401|403|404)
      echo "✅ edge correctly rejected audit ingest (HTTP $HTTP)"
      return 0
      ;;
    *)
      echo "❌ expected 401/403/404, got $HTTP"
      return 1
      ;;
  esac
}

register_test 18 "gateway EDGE rejects audit PUT (security)" t18
