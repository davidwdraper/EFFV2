#!/usr/bin/env bash
# user PUT (create) -> GET -> DELETE via gateway (4000), JWT act
# Auto-detects base: /api/user/users OR /api/user (proxy strips first segment)

_payload_user_replace_gw() {
  local ts; ts="$(date +%s)"
  json "{
    \"email\": \"smoke+${ts}@example.test\",
    \"firstname\": \"Smoke${ts}\",
    \"lastname\": \"Test${ts}\",
    \"userStatus\": 1,
    \"userType\": 1,
    \"imageIds\": []
  }"
}

_create_user_put_gw() {
  local TOKEN="$1" body; body="$(_payload_user_replace_gw)"
  local c code resp
  for c in "${GW}/api/user/users" "${GW}/api/user"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$c" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$body")
    if [[ "$code" == "404" ]]; then continue; fi
    resp=$(curl -fsS -X PUT "$c" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$body")
    echo "${c}|${resp}"
    return 0
  done
  echo ""
  return 1
}

t15() {
  local TOKEN; TOKEN=$(TOKEN_CALLER_ACT)

  local pair base resp id
  pair=$(_create_user_put_gw "$TOKEN")
  [[ -n "$pair" ]] || { echo "❌ user PUT via gateway not found (tried /api/user/users and /api/user)"; exit 1; }
  base="${pair%%|*}"; resp="${pair#*|}"
  echo "ℹ️  resolved user base (gateway): $base"
  printf '%s\n' "$resp" | pretty

  id=$(printf '%s' "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ user PUT (via gateway) did not return id/_id"; exit 1; }
  echo "✅ created user (via gateway) id=$id"

  curl -fsS -H "Authorization: Bearer $TOKEN" "$base/$id" | pretty
  delete_ok "$base/$id" -H "Authorization: Bearer $TOKEN"
}
register_test 15 "user PUT(create)+GET+DELETE via gateway (4000, JWT act)" t15
