# backend/tests/smoke/tests/002-svcfacilitator-health.sh
#!/usr/bin/env bash
set -Eeuo pipefail

: "${SVCFAC_BASE_URL:?SVCFAC_BASE_URL not set}"
: "${TIMEOUT_MS:=3000}"

# Hit /health and assert status=="ok"
resp="$(curl -sS --max-time "$(( (TIMEOUT_MS+999)/1000 ))" "$SVCFAC_BASE_URL/health")"
echo "$resp" | jq -e '.status=="ok"' >/dev/null
