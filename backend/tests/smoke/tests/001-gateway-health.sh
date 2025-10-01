# backend/tests/smoke/tests/001-gateway-health.sh
#!/usr/bin/env bash
set -Eeuo pipefail

: "${GATEWAY_BASE_URL:?GATEWAY_BASE_URL not set}"
: "${TIMEOUT_MS:=3000}"

# Hit /health and assert status=="ok"
resp="$(curl -sS --max-time "$(( (TIMEOUT_MS+999)/1000 ))" "$GATEWAY_BASE_URL/health")"
echo "$resp" | jq -e '.status=="ok"' >/dev/null
