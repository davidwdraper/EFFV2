#!/usr/bin/env bash
# scripts/smoke/tests/015_user_crud_via_gateway.sh
#
# user PUT(create) -> GET -> DELETE via gateway (4000)
# Canonical routing:
#   client →  /api/user/users   (slug=user, collection=users)
#   gateway → forwards '/users' to the user service

_payload_user_gateway() {
  # macOS-safe unique-ish id: epoch + 2x $RANDOM
  local ts; ts="$(date +%s)-$RANDOM-$RANDOM"
  json "{
    \"email\": \"smoke+${ts}@example.test\",
    \"firstname\": \"Smoke${ts}\",
    \"lastname\": \"Test${ts}\",
    \"userStatus\": 1,
    \"userType\": 1,
    \"imageIds\": []
  }"
}

t15() {
  local base="${GW}/api/user/users"  # singular slug + plural collection
  local body resp id
  body="$(_payload_user_gateway)"

  # ── CREATE (PUT /api/user/users via gateway) ───────────────────────────────
  resp=$(curl -fsS -X PUT "$base" \
    -H "Authorization: Bearer $(TOKEN_GATEWAY)" \
    -H "X-NV-User-Assertion: $(ASSERT_USER_GATEWAY smoke-tests 300)" \
    -H "Content-Type: application/json" \
    -d "$body")
  echo "ℹ️  resolved user base (gateway): $base"
  echo "$resp" | pretty

  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ user PUT (via gateway) did not return id/_id"; exit 1; }
  echo "✅ created user (via gateway) id=$id"

  # ── READ (GET /api/user/users/:id via gateway) ─────────────────────────────
  curl -fsS \
    -H "Authorization: Bearer $(TOKEN_GATEWAY)" \
    -H "X-NV-User-Assertion: $(ASSERT_USER_GATEWAY smoke-tests 300)" \
    "$base/$id" | pretty

  # ── DELETE (DELETE /api/user/users/:id via gateway) ────────────────────────
  delete_ok "$base/$id" \
    -H "Authorization: Bearer $(TOKEN_GATEWAY)" \
    -H "X-NV-User-Assertion: $(ASSERT_USER_GATEWAY smoke-tests 300)"
}

register_test 15 "user PUT(create)+GET+DELETE via gateway (4000) — /api/user/users" t15
