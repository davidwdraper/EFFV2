# backend/tests/smoke/tests/004-xxx-read-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — xxx read by saved id (expects DTO shape with xxxId)
set -euo pipefail
# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../lib.sh"

BASE="$(svc_base_for_xxx)"
ID="$(require_last_id)"
URL="$BASE/read/$ID"

RESP="$(_get_json "$URL")"
echo "$RESP" | jq -e . >/dev/null
[ "$(echo "$RESP" | jq -r '.ok // empty')" = "true" ] || { echo "ERROR: read not ok"; echo "$RESP" | jq .; exit 1; }

RIDV="$(jq -er '.doc.xxxId // .doc._id // .xxxId // empty' <<<"$RESP")"
[ "$RIDV" = "$ID" ] || { echo "ERROR: id mismatch ($RIDV != $ID)"; echo "$RESP" | jq .; exit 1; }

echo "OK: read id=$ID"
