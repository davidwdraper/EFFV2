# tests/smoke/017-jwks-keys.sh
#!/usr/bin/env bash
# Purpose: Verify jwks service returns a valid-looking JWK Set from /api/jwks/v1/keys

set -euo pipefail

BASE="${BASE:-http://127.0.0.1:4000}" # gateway base (per SOP, jwks is internalOnly)
RID="smoke-021-$(date +%s)"

echo "→ GET ${BASE}/api/jwks/v1/keys (rid=${RID})"
HTTP_CODE="$(curl -sS -w '%{http_code}' -o /tmp/jwks.json \
  -H "x-request-id: ${RID}" \
  "${BASE}/api/jwks/v1/keys")"

if [ "${HTTP_CODE}" != "200" ]; then
  echo "❌ Unexpected HTTP ${HTTP_CODE}. Body:"
  cat /tmp/jwks.json
  exit 1
fi

# Very light validation without jq dependency:
if grep -q '"keys"' /tmp/jwks.json; then
  echo "OK: keys array present"
else
  echo "❌ Response missing \"keys\" field"
  cat /tmp/jwks.json
  exit 1
fi

# Optional: stricter checks if jq is available
if command -v jq >/dev/null 2>&1; then
  COUNT="$(jq '.keys | length' /tmp/jwks.json)"
  if [ "${COUNT}" -ge 1 ]; then
    echo "OK: ${COUNT} key(s) returned"
  else
    echo "❌ No keys returned"
    cat /tmp/jwks.json
    exit 1
  fi
fi

echo "✅ PASS: 021-jwks-keys.sh"
