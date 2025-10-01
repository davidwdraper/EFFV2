# backend/tests/smoke/lib.sh
#!/usr/bin/env bash
set -Eeuo pipefail

# env: GATEWAY_BASE_URL, SVCFAC_BASE_URL, TIMEOUT_MS
: "${TIMEOUT_MS:=3000}"

_has_cmd(){ command -v "$1" >/dev/null 2>&1; }
_req_time(){ echo "$(( (TIMEOUT_MS+999)/1000 ))"; }

json_eq(){ # json_eq '<json>' 'jq-expr' 'expected'
  local body="$1" expr="$2" expect="$3"
  [[ "$(jq -er "$expr" <<<"$body")" == "$expect" ]]
}

health_direct(){ # health_direct <baseUrl>
  local base="$1"
  curl -sS --max-time "$(_req_time)" "$base/health"
}

# Canonical gateway health path for services (no legacy /live)
# Example slug: user, auth, etc.
health_via_gateway(){ # health_via_gateway <slug>
  local slug="$1"
  curl -sS --max-time "$(_req_time)" "$GATEWAY_BASE_URL/api/$slug/health"
}
