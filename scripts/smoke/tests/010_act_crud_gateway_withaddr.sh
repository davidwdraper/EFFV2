# /scripts/smoke/tests/010_act_crud_gateway_withaddr.sh
#!/usr/bin/env bash
t10() {
  if [[ -z "${MAIL_ADDR1}${MAIL_CITY}${MAIL_STATE}${MAIL_ZIP}" ]]; then
    echo "⚠️  Provide MAIL_ADDR1/MAIL_CITY/MAIL_STATE/MAIL_ZIP to trigger geocode." >&2
  fi
  local TOKEN; TOKEN=$(TOKEN_CALLER_ACT)
  local base="$GW/api/act/acts"
  local resp id
  resp=$(curl -sS -X PUT "$base" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(payload_act_with_address)")
  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ gateway PUT+address did not return _id"; exit 1; }
  echo "✅ created via gateway(with addr) _id=$id"
  curl -sS -H "Authorization: Bearer $TOKEN" "$base/$id" | pretty
  delete_ok "$base/$id" -H "Authorization: Bearer $TOKEN"
}
register_test 10 "act PUT+GET+DELETE via gateway WITH address → geocode (JWT act)" t10
