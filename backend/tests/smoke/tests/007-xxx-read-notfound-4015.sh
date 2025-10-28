# backend/tests/smoke/tests/007-xxx-read-notfound-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — xxx read notfound (use the same saved id after deletion)
set -euo pipefail
# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../lib.sh"

BASE="$(svc_base_for_xxx)"
ID="$(require_last_id)"
URL="$BASE/read/$ID"

RESP="$(_get_json "$URL")"
echo "$RESP" | jq -e . >/dev/null

STATUS="$(echo "$RESP" | jq -r '.status // empty')"
CODE="$(echo "$RESP" | jq -r '.code // empty')"
if [ "$STATUS" != "404" ] && [ "$STATUS" != "404 Not Found" ] && [ "$CODE" != "NOT_FOUND" ]; then
  echo "ERROR: expected 404 NOT_FOUND"
  echo "$RESP" | jq .
  exit 1
fi

echo "OK: read notfound for _id=$ID"
