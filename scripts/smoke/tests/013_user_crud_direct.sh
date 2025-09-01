#!/usr/bin/env bash
# user PUT (create) -> GET -> DELETE direct (port 4001), JWT core
# Auto-detects base: /api/user OR /api/users (no id on PUT)

_payload_user_replace() {
  # Matches zUserReplace: required email, firstname, lastname (+ a couple optionals)
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

# Try a PUT against candidate bases; return "BASE|RESPJSON" for the first non-404
_create_user_put_direct() {
  local TOKEN="$1" body; body="$(_payload_user_replace)"
  local c code resp
  for c in "${USER_URL}/api/user" "${USER_URL}/api/users"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$c" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$body")
    if [[ "$code" == "404" ]]; then continue; fi
    # real call (fail loud if 4xx/5xx but we know it's not 404)
    resp=$(curl -fsS -X PUT "$c" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$body")
    echo "${c}|${resp}"
    return 0
  done
  echo ""
  return 1
}

t13() {
  local TOKEN; TOKEN=$(TOKEN_CORE)

  local pair base resp id
  pair=$(_create_user_put_direct "$TOKEN")
  [[ -n "$pair" ]] || { echo "❌ user PUT route not found (tried /api/user and /api/users)"; exit 1; }
  base="${pair%%|*}"; resp="${pair#*|}"
  echo "ℹ️  resolved user base (direct): $base"
  printf '%s\n' "$resp" | pretty

  id=$(printf '%s' "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ user PUT (direct) did not return id/_id"; exit 1; }
  echo "✅ created user (direct) id=$id"

  curl -fsS -H "Authorization: Bearer $TOKEN" "$base/$id" | pretty
  delete_ok "$base/$id" -H "Authorization: Bearer $TOKEN"
}
register_test 13 "user PUT(create)+GET+DELETE direct (4001, JWT core)" t13
