#!/usr/bin/env bash
# user PUT(create) -> GET -> DELETE direct (4001), S2S (JWT core)

# Single source of truth: one request, capture body+status together.
_put_with_body_and_status() {
  local url="$1" token="$2" body="$3"
  # Print body, then last line is status
  curl -sS -X PUT "$url" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$body" \
    -w '\n%{http_code}'
}

_payload_user_replace() {
  # Unique email every time
  local ts rand; ts="$(date +%s%N)"; rand=$RANDOM
  json "{
    \"email\": \"smoke+${ts}${rand}@example.test\",
    \"firstname\": \"Smoke${ts}\",
    \"lastname\": \"Test${ts}\",
    \"userStatus\": 1,
    \"userType\": 1,
    \"imageIds\": []
  }"
}

t13() {
  local TOKEN; TOKEN=$(TOKEN_CORE)
  local base="${USER_URL}/api/user"
  local out body code id

  # CREATE (single PUT, no preflight)
  out="$(_put_with_body_and_status "$base" "$TOKEN" "$(_payload_user_replace)")"
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  if [[ ! "$code" =~ ^2 ]]; then
    echo "$body" | pretty
    echo "❌ PUT(create) failed (HTTP $code)"; exit 1
  fi
  echo "$body" | pretty
  id=$(printf '%s' "$body" | extract_id)
  [[ -n "$id" ]] || { echo "❌ PUT(create) did not return id/_id"; exit 1; }
  echo "✅ created user (direct) id=$id"

  # GET
  curl -fsS -H "Authorization: Bearer $TOKEN" "$base/$id" | pretty

  # DELETE
  delete_ok "$base/$id" -H "Authorization: Bearer $TOKEN"
}
register_test 13 "user PUT+GET+DELETE direct (4001, S2S core)" t13
