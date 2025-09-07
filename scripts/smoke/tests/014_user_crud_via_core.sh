#!/usr/bin/env bash
# scripts/smoke/tests/014_user_crud_via_core.sh
# user PUT(create) -> GET -> DELETE via gateway-core (4011)
# Route: client → /api/user/users (slug=user, resource=users)

_payload_user_core() {
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

t14() {
  local base="${CORE}/api/user/users"
  local body resp id
  body="$(_payload_user_core)"

  # Properly QUOTED headers (no command substitution of helpers)
  local AUTHZ="Authorization: Bearer $(TOKEN_CORE)"
  local ASSERT="X-NV-User-Assertion: $(ASSERT_USER)"

  # CREATE
  resp=$(curl -fsS -X PUT "$base" \
    -H "$AUTHZ" \
    -H "$ASSERT" \
    -H "Content-Type: application/json" \
    -d "$body")
  echo "ℹ️  resolved user base (core): $base"
  echo "$resp" | pretty

  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ user PUT (via core) did not return id/_id"; exit 1; }
  echo "✅ created user (via core) id=$id"

  # READ
  curl -fsS -H "$AUTHZ" -H "$ASSERT" "$base/$id" | pretty

  # DELETE
  delete_ok "$base/$id" -H "$AUTHZ" -H "$ASSERT"
}

register_test 14 "user PUT+GET+DELETE via core (4011, JWT act) — /api/user/users" t14
