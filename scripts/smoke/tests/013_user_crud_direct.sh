# scripts/smoke/tests/013_user_crud_direct.sh
#!/usr/bin/env bash
# user PUT(create) -> GET -> DELETE directly against the user service (4001)
# Contract: service exposes /api/users (plural)
# Uses smoke.lib.sh helpers for token minting but avoids $(AUTH_HEADERS_CORE) word-splitting.

_payload_user() {
  local ts; ts="$(date +%s%N)"
  json "{
    \"email\": \"smoke+${ts}@example.test\",
    \"firstname\": \"Smoke${ts}\",
    \"lastname\": \"Test${ts}\",
    \"userStatus\": 1,
    \"userType\": 1,
    \"imageIds\": []
  }"
}

t13() {
  # Mint tokens via helpers in smoke.lib.sh
  local S2S; S2S="$(TOKEN_CORE)"
  local UA;  UA="$(ASSERT_USER "smoke-tests" 300)"

  # Base to the service (plural route)
  local base="${USER_URL}/api/users"

  # Create
  local body resp id
  body="$(_payload_user)"
  resp=$(curl -fsS -X PUT "$base" \
    -H "Authorization: Bearer ${S2S}" \
    -H "X-NV-User-Assertion: ${UA}" \
    -H "Content-Type: application/json" \
    -d "$body")
  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ direct PUT did not return id/_id"; exit 1; }
  echo "✅ created user (direct) id=$id"

  # Read
  curl -fsS \
    -H "Authorization: Bearer ${S2S}" \
    -H "X-NV-User-Assertion: ${UA}" \
    "$base/$id" | pretty

  # Delete
  delete_ok "$base/$id" \
    -H "Authorization: Bearer ${S2S}" \
    -H "X-NV-User-Assertion: ${UA}"
}

register_test 13 "user PUT+GET+DELETE direct (4001) — plural /api/users" t13
