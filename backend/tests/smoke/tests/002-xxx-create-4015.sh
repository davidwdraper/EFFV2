# backend/tests/smoke/tests/002-xxx-create-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — xxx create (saves DTO id + payload for subsequent tests)
set -euo pipefail
# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../lib.sh"

BASE="$(svc_base_for_xxx)"
URL="$BASE/create"
RID="smoke-create-$$"
SUF="$(date +%s)$$"

# Single payload used for ALL subsequent tests (dup/read/delete/notfound)
BODY="$(cat <<JSON
{"txtfield1":"alpha-$SUF","txtfield2":"bravo-$SUF","numfield1":1,"numfield2":2}
JSON
)"

RESP="$(_put_json "$URL" "$BODY")"
echo "$RESP" | jq -e . >/dev/null
[ "$(echo "$RESP" | jq -r '.ok // empty')" = "true" ] || { echo "ERROR: create not ok"; echo "$RESP" | jq .; exit 1; }

ID="$(extract_id "$RESP")"
[ -n "$ID" ] || { echo "ERROR: no id in response (.id | .doc.xxxId | .doc._id | .xxxId)"; echo "$RESP" | jq .; exit 1; }

save_last_id "$ID"
save_create_payload "$BODY"
echo "OK: created id=$ID"
