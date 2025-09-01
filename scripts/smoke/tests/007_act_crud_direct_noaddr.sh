# /scripts/smoke/tests/007_act_crud_direct_noaddr.sh
#!/usr/bin/env bash
t7() {
  local TOKEN; TOKEN=$(TOKEN_CORE)
  local base="$ACT/api/acts"
  local resp id
  resp=$(curl -sS -X PUT "$base" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(payload_act_minimal)")
  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ direct PUT did not return _id"; exit 1; }
  echo "✅ created direct _id=$id"
  curl -sS -H "Authorization: Bearer $TOKEN" "$base/$id" | pretty
  delete_ok "$base/$id" -H "Authorization: Bearer $TOKEN"
}
register_test 7 "act PUT+GET+DELETE direct (4002) no address (JWT core)" t7
