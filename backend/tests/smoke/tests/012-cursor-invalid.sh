# backend/services/t_entity_crud/smokes/012-cursor-invalid.sh
#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"
BASE="http://${HOST}:${PORT}/api/xxx/v1"

say(){ printf '%s\n' "$*" >&2; }

BAD="not-a-valid-base64-cursor"

RESP="$(curl -sS "${BASE}/list?limit=3&cursor=${BAD}")"

STATUS="$(echo "$RESP" | jq -r '.status // empty')"
OK="$(echo "$RESP" | jq -r '.ok // empty')"

if [[ "$OK" == "true" ]]; then
  say "ERROR: expected failure for invalid cursor, got ok=true"; exit 1
fi

# Accept any 4xx surfaced by problem+json
if [[ -z "$STATUS" ]] || ! [[ "$STATUS" =~ ^4[0-9][0-9]$ ]]; then
  say "ERROR: expected problem+json 4xx status; got: $RESP"; exit 1
fi

say "OK: invalid cursor correctly rejected with client error."
exit 0
