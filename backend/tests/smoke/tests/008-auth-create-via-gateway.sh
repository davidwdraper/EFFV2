# backend/tests/smoke/tests/008-auth-create-via-gateway.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke: Auth.create → User.create (S2S) via Gateway
# Requires: gateway :4000, auth :4010 (proxied), user :4020 (proxied)
# Flow:
#   1) POST /api/auth/v1/create  with { email, password }
#   2) Expect ok=true, service=auth (and a user id/email in payload)
#   3) Cleanup: DELETE /api/user/v1/users/:id  (best-effort)
# macOS bash 3.2 compatible
# ============================================================================
set -euo pipefail

CREATE_URL="http://127.0.0.1:4000/api/auth/v1/create"
DELETE_BASE="http://127.0.0.1:4000/api/user/v1/users"

# Unique-ish test email to avoid collisions on repeated runs
TS="$(date +%s)"
EMAIL="smoke+$TS@example.com"
PASSWORD="CorrectHorseBatteryStaple42!"

cleanup() {
  # If we extracted a user id, try to delete it
  if [ -n "${USER_ID:-}" ]; then
    echo "→ DELETE ${DELETE_BASE}/${USER_ID}"
    # best-effort; don't fail the whole trap on cleanup
    curl -sS -X DELETE -H 'Accept: application/json' "${DELETE_BASE}/${USER_ID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "→ POST ${CREATE_URL}"
REQ_BODY="$(jq -n --arg email "$EMAIL" --arg pw "$PASSWORD" '{ email: $email, password: $pw }')"

RESP="$(curl -sS -X POST \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/json' \
  --data "$REQ_BODY" \
  "$CREATE_URL" || true)"

if [ -z "$RESP" ]; then
  echo "ERROR: Empty response from $CREATE_URL"
  exit 1
fi

if ! echo "$RESP" | jq -e . >/dev/null 2>&1; then
  echo "ERROR: Non-JSON response from $CREATE_URL:"
  echo "$RESP"
  exit 1
fi

OK="$(echo "$RESP" | jq -r '.ok // empty')"
SERVICE="$(echo "$RESP" | jq -r '.service // empty')"

if [ "$OK" != "true" ] || [ "$SERVICE" != "auth" ]; then
  echo "ERROR: Unexpected payload (expecting ok=true & service=auth):"
  echo "$RESP" | jq .
  exit 1
fi

# Try to extract a user id and email from common shapes:
#   .data.user._id OR .data.userId OR .data.user.id
USER_ID="$(echo "$RESP" | jq -r '
  ( .data.user._id // .data.userId // .data.user.id // empty ) | tostring
')"
USER_EMAIL="$(echo "$RESP" | jq -r '
  ( .data.user.email // .data.email // empty ) | tostring
')"

# Sanity check echo (not required, just helpful during dev)
echo "INFO: created user id='${USER_ID:-<none>}' email='${USER_EMAIL:-<none>}'"

# Validate that the returned email (if present) matches what we sent
if [ -n "$USER_EMAIL" ] && [ "$USER_EMAIL" != "$EMAIL" ]; then
  echo "ERROR: Returned user email does not match request:"
  echo "$RESP" | jq .
  exit 1
fi

# If an id was returned, attempt cleanup now (and keep trap as a safety net)
if [ -n "$USER_ID" ]; then
  echo "→ DELETE ${DELETE_BASE}/${USER_ID}"
  DEL_RESP="$(curl -sS -X DELETE -H 'Accept: application/json' "${DELETE_BASE}/${USER_ID}" || true)"
  # Don't fail if delete shape differs; just ensure JSON
  if ! echo "$DEL_RESP" | jq -e . >/dev/null 2>&1; then
    echo "WARN: Non-JSON delete response:"
    echo "$DEL_RESP"
  fi
  # Clear USER_ID to avoid double cleanup in trap
  unset USER_ID
fi

echo "OK: gateway→auth.create (S2S to user.create) works and cleanup attempted"
