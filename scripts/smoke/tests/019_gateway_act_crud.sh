#!/usr/bin/env bash
# NowVibin Smoke Tests — Test 19
# Act CRUD via GATEWAY with audit WAL verification (self-minting auth)
#
# Enhancements:
# - Unique Act name to dodge unique index
# - Uses AUTH_HEADERS_GATEWAY_ARR (array-safe) for curl
# - **Asserts** audit WAL correlation by grepping x-request-id in current NDJSON
# - Fails if WAL file didn’t grow or request id not found

register_test "19" "Act CRUD via gateway + WAL" "nv_test_19_act_gateway_wal"

nv_test_19_act_gateway_wal() {
  local create_url="${GW%/}/api/act/acts"
  local audit_url="${GW%/}/__audit"

  local jq_cmd="cat"
  if [[ ${NV_USE_JQ:-1} -eq 1 ]] && command -v "${JQ:-jq}" >/dev/null 2>&1; then
    jq_cmd="${JQ:-jq}"
  fi

  # Snapshot WAL (before) and note current file + size
  echo "-- WAL snapshot (before) --"
  local wal_file wal_before_bytes
  wal_file="$(nv_audit_current_file)"
  if [[ -n "$wal_file" && -f "$wal_file" ]]; then
    wal_before_bytes="$(nv_file_bytes "$wal_file")"
  else
    wal_before_bytes=0
  fi
  curl -sS "${audit_url}" | ${jq_cmd} . || echo "(diag unavailable; continuing)"

  # Unique name to satisfy unique index (name, homeTownId)
  local uniq name payload
  uniq="$(nv_unique_suffix)"
  name="SmokeTest Act ${uniq}"
  payload="$(payload_act_minimal_named "${name}")"

  # Build auth header array safely
  AUTH_HEADERS_GATEWAY_ARR

  # CREATE (PUT)
  local hdr body code id req_id
  hdr="$(mktemp)"; body="$(mktemp)"
  code="$(
    curl -sS -X PUT "${create_url}" \
      "${NV_AUTH_HEADERS[@]}" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json' \
      --data-binary "${payload}" \
      -D "${hdr}" -o "${body}" -w '%{http_code}'
  )"

  echo "-- CREATE status: ${code}"
  echo "-- CREATE headers:"
  sed -e 's/\r$//' "${hdr}" | sed 's/^/  /'
  echo "-- CREATE body:"
  if [[ ${NV_USE_JQ:-1} -eq 1 ]]; then ${jq_cmd} . < "${body}" || cat "${body}"; else cat "${body}"; fi

  if [[ "$code" != "200" && "$code" != "201" ]]; then
    rm -f "${hdr}" "${body}"
    echo "❌ create failed (status ${code})"
    return 1
  fi

  # Extract id and x-request-id
  id="$(extract_id < "${body}")"
  req_id="$(sed -n 's/^[Xx]-[Rr]equest-[Ii][Dd]:[[:space:]]*\(.*\)\r\{0,1\}$/\1/p' "${hdr}" | tr -d '\r' | tail -n1)"
  rm -f "${hdr}" "${body}"
  if [[ -z "$id" ]]; then
    echo "❌ create succeeded but no id/_id found in response"
    return 2
  fi
  echo "✅ created via gateway id=${id} name='${name}' reqId=${req_id:-<none>}"

  # GET (verify round-trip)
  local get_url="${GW%/}/api/act/acts/${id}"
  hdr="$(mktemp)"; body="$(mktemp)"
  code="$(
    curl -sS "${get_url}" \
      "${NV_AUTH_HEADERS[@]}" \
      -D "${hdr}" -o "${body}" -w '%{http_code}'
  )"
  echo "-- GET status: ${code}"
  echo "-- GET body:"
  if [[ ${NV_USE_JQ:-1} -eq 1 ]]; then ${jq_cmd} . < "${body}" || cat "${body}"; else cat "${body}"; fi
  if [[ "$code" != "200" ]]; then
    rm -f "${hdr}" "${body}"
    echo "❌ unexpected GET status ${code}"
    return 3
  fi
  local got_id
  got_id="$(extract_id < "${body}")"
  rm -f "${hdr}" "${body}"
  if [[ "$got_id" != "$id" ]]; then
    echo "❌ GET returned different id (${got_id})"
    return 4
  fi
  echo "✅ fetched via gateway id=${got_id}"

  # DELETE (idempotent: 200/202/204/404)
  local del_url="${GW%/}/api/act/acts/${id}"
  delete_ok "${del_url}" "${NV_AUTH_HEADERS[@]}" || return 5

  # Allow WAL to flush to disk
  sleep 1

  # Snapshot after and assert WAL growth + correlation
  echo "-- WAL snapshot (after) --"
  curl -sS "${audit_url}" | ${jq_cmd} . || echo "(diag unavailable; continuing)"

  # Resolve current WAL file again (rotation-safe)
  local wal_after_file wal_after_bytes
  wal_after_file="$(nv_audit_current_file)"
  if [[ -z "$wal_after_file" ]]; then wal_after_file="$wal_file"; fi
  if [[ -n "$wal_after_file" && -f "$wal_after_file" ]]; then
    wal_after_bytes="$(nv_file_bytes "$wal_after_file")"
  else
    wal_after_bytes=0
  fi

  local grew="no"
  if [[ "$wal_after_bytes" -gt "$wal_before_bytes" ]]; then grew="yes"; fi
  echo "WAL grew: $grew (before=${wal_before_bytes} after=${wal_after_bytes})"

  # Correlate x-request-id if we have one
  if [[ -n "${req_id:-}" && -n "$wal_after_file" && -f "$wal_after_file" ]]; then
    if grep -Fq "$req_id" "$wal_after_file"; then
      echo "✅ WAL correlation: requestId ${req_id} found in ${wal_after_file}"
    else
      echo "❌ WAL correlation: requestId ${req_id} NOT found in ${wal_after_file}"
      return 6
    fi
  else
    echo "⚠️  WAL correlation skipped (reqId or wal file missing)"
    # still require WAL growth so we know something was written
    if [[ "$grew" != "yes" ]]; then
      echo "❌ WAL did not grow and correlation unavailable"
      return 7
    fi
  fi

  return 0
}
