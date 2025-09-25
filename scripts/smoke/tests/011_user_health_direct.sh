#!/usr/bin/env bash
# NowVibin — Smoke Tests
# Test: 011 — user health via gateway (svcconfig-proxied)
#
# WHY:
# - Enforce gateway-only testing so edge auth & S2S flows are exercised.
# - Health endpoints remain public, but we still route through the gateway to
#   ensure svcconfig-driven upstream resolution and proxying work.
#
# REQS:
# - Gateway exposes /api/<slug>/health/* and uses svcconfig to resolve upstream.
# - No shared secrets for S2S in env; all internal mint/verify uses KMS/JWKS.
#
# DOCS:
# - docs/architecture/backend/HEALTH_READINESS.md
# - docs/architecture/backend/SOP.md
# - docs/design/backend/gateway/PROXYING.md (upstream resolution via svcconfig)
#
# ADRs:
# - docs/adr/0032-gateway-first-health-proxy-via-svcconfig.md (proposed)
#
# Notes:
# - Uses gateway_req wrapper for consistent edge headers (client + assertion).
# - Health is unversioned by design; stays off /api/<slug>.V# to keep it simple.
#
# IMPORTANT:
# - Do NOT `set -euo pipefail` or `source smoke.lib.sh` here — the runner already
#   sets shell options and sources libs. Re-sourcing wipes TESTS=().

t11() {
  local url="${GW%/}/api/user/health/live"
  echo "— GET ${url}"
  gateway_req GET "$url" | pretty

  # Basic schema checks: {"ok":true,"service":"user",...}
  local code ok
  code=$(curl -s -o /dev/null -w '%{http_code}' -X GET "$url" \
         -H "Accept: application/json")
  if [[ "$code" != "200" ]]; then
    echo "❌ user health via gateway returned HTTP $code"
    return 1
  fi

  ok=$(gateway_req GET "$url" | ${JQ:-jq} -r '.ok // false' 2>/dev/null || echo "false")
  if [[ "$ok" != "true" ]]; then
    echo "❌ user health payload missing/false .ok"
    return 2
  fi

  return 0
}

register_test 11 "user health via gateway (4000 → svcconfig → user)" t11
