# backend/tests/smoke/tests/005-xxx-delete-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — xxx delete by saved id
set -euo pipefail
# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../lib.sh"

BASE="$(svc_base_for_xxx)"
ID="$(require_last_id)"
URL="$BASE/delete/$ID"

RESP="$(_del_json "$URL")"
echo "$RESP" | jq -e . >/dev/null
[ "$(echo "$RESP" | jq -r '.ok')" = "true" ] || { echo "ERROR: delete not ok"; echo "$RESP" | jq .; exit 1; }
[ "$(echo "$RESP" | jq -r '.deleted')" = "1" ] || { echo "ERROR: deleted != 1"; echo "$RESP" | jq .; exit 1; }

echo "OK: deleted _id=$ID"
