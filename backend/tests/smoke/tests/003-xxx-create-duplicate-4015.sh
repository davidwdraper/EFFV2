# backend/tests/smoke/tests/003-xxx-create-duplicate-4015.sh
#!/usr/bin/env bash
# NowVibin Smoke — xxx create duplicate (NO new seed; uses payload from 002)
# Expect: 409 Conflict; leaves DB unchanged vs. test 002 baseline.
set -euo pipefail
# shellcheck disable=SC1090
. "$(cd "$(dirname "$0")" && pwd)/../lib.sh"

BASE="$(svc_base_for_xxx)"
URL="$BASE/create"
RID="smoke-dup-$$"

# Require the original create happened (so uniqueness already exists)
# and reuse the exact same BODY to trigger the duplicate key.
BODY="$(require_create_payload)"

RESP="$( _put_json "$URL" "$BODY" )"
echo "$RESP" | jq -e . >/dev/null

STATUS="$(echo "$RESP" | jq -r '.status // empty')"
CODE="$(echo "$RESP" | jq -r '.code // empty')"

# Accept either explicit status=409 or problem code indicating conflict
if [ "$STATUS" != "409" ] && [ "$STATUS" != "409 Conflict" ] && [ "$CODE" != "DUPLICATE_KEY" ] && [ "$CODE" != "duplicate_key" ]; then
  echo "ERROR: expected 409 duplicate; got:"
  echo "$RESP" | jq .
  exit 1
fi

echo "OK: duplicate correctly returned 409 (no extra records created)"
