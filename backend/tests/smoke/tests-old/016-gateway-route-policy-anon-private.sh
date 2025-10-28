# scripts/smoke/016-gateway-route-policy-anon-private.sh
#!/usr/bin/env bash
# NowVibin (NV)
# Docs:
# - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
# - ADR-0038 — Route Policy Gate at Gateway & Facilitator Endpoints
#
# Purpose:
# - Validate routePolicyGate default stance: endpoints are PRIVATE unless an explicit
#   routePolicy exists with minAccessLevel == 0.
# - Case under test: Anonymous request, NO routePolicy for endpoint → expect 401.
#
# Preconditions:
# - Gateway is running and svcconfig mirror is warm.
# - The target <slug> exists in svcconfig, but the specific (method,path) has **no** routePolicy.
#   (Pick any path segment that you have NOT created a policy for.)
#
# Env (no fallbacks beyond these defaults — adjust as needed):
#   GATEWAY_BASE   : e.g., http://127.0.0.1:4000
#   SLUG           : e.g., auth (must exist in svcconfig mirror)
#   VERSION        : default 1
#   METHOD         : default GET
#   PATH_SEG       : default "no-policy-here"
#
# Pass criteria:
# - HTTP 401
# - (Optional) response JSON includes title "unauthorized" and detail code "private_by_default_no_policy".

set -euo pipefail

GATEWAY_BASE="${GATEWAY_BASE:-http://127.0.0.1:4000}"
SLUG="${SLUG:-auth}"
VERSION="${VERSION:-1}"
METHOD="${METHOD:-GET}"
PATH_SEG="${PATH_SEG:-no-policy-here}"

URL="${GATEWAY_BASE}/api/${SLUG}/v${VERSION}/${PATH_SEG}"

echo "── running: 016-gateway-route-policy-anon-private"
echo "→ ${METHOD} ${URL}"

# Make anonymous call (no Authorization header)
HTTP_CODE=""
BODY=""
if BODY=$(curl -sS -X "${METHOD}" \
  -H "accept: application/json" \
  -w "\n%{http_code}" \
  "${URL}"); then
  :
else
  # curl error (network, DNS, etc.)
  echo "❌ FAIL: curl error during request"
  exit 1
fi

# Split body and code (last line is code because of -w)
HTTP_CODE="$(printf "%s" "$BODY" | tail -n1)"
RESP="$(printf "%s" "$BODY" | sed '$d')"

if [[ "$HTTP_CODE" != "401" ]]; then
  echo "❌ FAIL: expected 401, got ${HTTP_CODE}"
  echo "Response body:"
  echo "$RESP"
  exit 1
fi

# Optional lightweight checks without jq (keep runner lean)
TITLE_MATCH="$(printf "%s" "$RESP" | grep -c '"title"\s*:\s*"unauthorized"' || true)"
DETAIL_MATCH="$(printf "%s" "$RESP" | grep -c 'private_by_default_no_policy' || true)"

if [[ "$TITLE_MATCH" -lt 1 || "$DETAIL_MATCH" -lt 1 ]]; then
  echo "⚠️  WARN: 401 received but response body did not include expected fields."
  echo "Expected: title:'unauthorized' and detail:'private_by_default_no_policy'"
  echo "Body:"
  echo "$RESP"
  # Still pass on status code correctness
  echo "✅ PASS (status-only)"
  exit 0
fi

echo "✅ PASS"
exit 0
