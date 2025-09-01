# /scripts/smoke/tests/008_act_crud_gateway_noaddr.sh
#!/usr/bin/env bash
t8() {
  local TOKEN; TOKEN=$(TOKEN_CALLER_ACT)
  local base="$GW/api/act/acts"
  local resp id
  resp=$(curl -sS -X PUT "$base" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(payload_act_minimal)")
  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ gateway PUT did not return _id"; exit 1; }
  echo "✅ created via gateway _id=$id"
  curl -sS -H "Authorization: Bearer $TOKEN" "$base/$id" | pretty
  delete_ok "$base/$id" -H "Authorization: Bearer $TOKEN"
}
register_test 8 "act PUT+GET+DELETE via gateway (4000) no address (JWT act)" t8
