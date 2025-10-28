# backend/tests/smoke/tests/006-xxx-delete-notfound-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — xxx delete notfound (use the same saved id after deletion)
set -euo pipefail
# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../lib.sh"

BASE="$(svc_base_for_xxx)"
ID="$(require_last_id)"
URL="$BASE/delete/$ID"

RESP="$(_del_json "$URL")"
echo "$RESP" | jq -e . >/dev/null

STATUS="$(echo "$RESP" | jq -r '.status // empty')"
CODE="$(echo "$RESP" | jq -r '.code // empty')"
if [ "$STATUS" != "404" ] && [ "$STATUS" != "404 Not Found" ] && [ "$CODE" != "NOT_FOUND" ]; then
  echo "ERROR: expected 404 NOT_FOUND"
  echo "$RESP" | jq .
  exit 1
fi

echo "OK: delete notfound for _id=$ID"
