# backend/tests/smoke/tests/001-xxx-health-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — xxx health (port 4015)
set -euo pipefail

BASE="${SVCFAC_BASE_URL:-http://127.0.0.1:4015}/api/xxx/v1"
URL="$BASE/health"

echo "→ GET $URL" >&2
RESP="$(curl -sS -H 'Accept: application/json' "$URL")"

# must be JSON
echo "$RESP" | jq -e . >/dev/null

# Assert envelope (lenient: only require ok==true; service==xxx if present)
OK="$(echo "$RESP" | jq -r 'select(.ok!=null) | .ok')"
[ "$OK" = "true" ] || { echo "ERROR: ok != true"; echo "$RESP" | jq .; exit 1; }

# If service present, ensure it matches
if echo "$RESP" | jq -e 'has("service")' >/dev/null; then
  SVC="$(echo "$RESP" | jq -r '.service')"
  [ "$SVC" = "xxx" ] || { echo "ERROR: service != xxx"; echo "$RESP" | jq .; exit 1; }
fi

echo "OK: health ready"
