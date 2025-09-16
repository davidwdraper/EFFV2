#!/usr/bin/env bash
# Act create/get/delete directly against service port (4002), no address fields.
# Uses a unique name per run to avoid Mongo E11000 on (name, homeTownId).

t7() {
  local base="$ACT/api/acts"
  local resp id nm
  nm="SmokeTest Act $(nv_unique_suffix)"

  # Create (PUT) with unique name; add a curl max-time to avoid “hang” feels
  resp=$(nv_req PUT "$base" \
    -H "Content-Type: application/json" \
    --max-time "${NV_CURL_MAXTIME:-12}" \
    -d "$(payload_act_minimal_named "$nm")")

  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ direct PUT did not return _id (name=$nm)"; exit 1; }
  echo "✅ created direct _id=$id (name=$nm)"

  # Read (GET)
  nv_req GET "$base/$id" --max-time "${NV_CURL_MAXTIME:-12}" | pretty

  # Delete (DELETE) — delete_ok treats 200/202/204/404 as success
  AUTH_HEADERS_SVC_ARR "${SMOKE_S2S_CALLER:-gateway}"
  delete_ok "$base/$id" "${NV_AUTH_HEADERS[@]}" --max-time "${NV_CURL_MAXTIME:-12}"
}

register_test 7 "act PUT+GET+DELETE direct (4002) no address (JWT svc)" t7
