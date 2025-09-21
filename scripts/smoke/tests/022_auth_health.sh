# PATH: scripts/smoke/tests/022_auth_health.sh
#!/usr/bin/env bash
# Auth health via GATEWAY (4000), unversioned health proxy.
# Examples:
#   GET $GW/auth/health/live
#   GET $GW/auth/health/ready

t22() {
  set -euo pipefail

  local base="${GW:-http://127.0.0.1:4000}/auth/health"
  local max_time="${NV_CURL_MAXTIME:-8}"

  echo "— /live —"
  curl -sS "$base/live" --max-time "$max_time" | { if command -v jq >/dev/null 2>&1; then jq; else cat; fi; }

  echo "— /ready —"
  curl -sS "$base/ready" --max-time "$max_time" | { if command -v jq >/dev/null 2>&1; then jq; else cat; fi; }

  echo "✅ auth health endpoints reachable via gateway"
}

register_test 22 "auth health (gateway)" t22
