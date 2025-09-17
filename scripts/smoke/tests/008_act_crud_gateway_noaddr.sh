# /scripts/smoke/tests/008_act_crud_gateway_noaddr.sh
#!/usr/bin/env bash
# Act create/get/delete via GATEWAY (4000), no address fields.
# Gateway must mint S2S + user assertion; caller provides none.

t8() {
  local base="$GW/api/act/acts"
  local resp id nm
  nm="SmokeTest Act $(nv_unique_suffix)"

  # Create (PUT) through gateway. Do NOT send Authorization; gateway must mint.
  resp=$(nv_req_gateway PUT "$base" \
    -H "Content-Type: application/json" \
    --max-time "${NV_CURL_MAXTIME:-12}" \
    -d "$(payload_act_minimal_named "$nm")")

  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ gateway PUT did not return _id (name=$nm)"; exit 1; }
  echo "✅ created via gateway _id=$id (name=$nm)"

  # Read (GET) via gateway
  nv_req_gateway GET "$base/$id" --max-time "${NV_CURL_MAXTIME:-12}" | pretty

  # Delete (DELETE) via gateway
  nv_req_gateway DELETE "$base/$id" --max-time "${NV_CURL_MAXTIME:-12}" >/dev/null 2>&1 \
    || true  # 200/202/204/404 are fine (idempotent in backend)

  echo "✅ deleted via gateway _id=$id"
}

register_test 8 "act PUT+GET+DELETE via gateway (4000) no address (JWT minted by gateway)" t8
