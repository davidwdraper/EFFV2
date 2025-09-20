#!/usr/bin/env bash
# PATH: scripts/smoke/tests/007_act_crud_gateway_noaddr.sh
#
# Test 7: Act PUT + GET + DELETE via GATEWAY (versioned path), no mailing address.
# Requires gateway edge auth (client bearer) — the smoke lib provides it via gateway_req.

t7() {
  local base="${GW%/}/api/act.V1/acts"
  local resp id nm
  nm="SmokeTest Act $(nv_unique_suffix)"

  # Create (PUT) with unique name
  resp=$(gateway_req PUT "$base" \
    --max-time "${NV_CURL_MAXTIME:-12}" \
    -d "$(payload_act_minimal_named "$nm")")

  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ gateway PUT did not return _id (name=$nm)"; return 1; }
  echo "✅ created via gateway _id=$id (name=$nm)"

  # Read (GET)
  gateway_req GET "$base/$id" --max-time "${NV_CURL_MAXTIME:-12}" | pretty

  # Delete (DELETE) — treat 200/202/204/404 as success
  AUTH_HEADERS_CLIENT_ARR
  delete_ok "$base/$id" "${NV_CLIENT_HEADERS[@]}" --max-time "${NV_CURL_MAXTIME:-12}"
}

register_test 7 "act PUT+GET+DELETE (gateway, V1, client auth)" t7
