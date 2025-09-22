# /scripts/smoke/tests/025_log_ingest_direct.sh
#!/usr/bin/env bash
# log ingest DIRECT (service port) — POST /api/log/v1/logs
# Internal-only: requires S2S; allowlist enforced by service middleware.
# Uses s2s.sh from smoke libs (already sourced by runner).
: "${LOG_URL:=http://127.0.0.1:4006}"
: "${NV_CURL_MAXTIME:=20}"  # allow cold DB/index warmup

t25() {
  set -euo pipefail

  local BASE="${LOG_URL%/}/api/log/v1/logs"
  local AUTH="Authorization: Bearer $(s2s_token gateway 300)"   # change caller if your allowlist differs
  local REQID="smoke-$(nv_unique_suffix)"

  local eid ts
  eid="smoke-log-$(nv_unique_suffix)"
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  read -r -d '' PAYLOAD <<JSON || true
{
  "eventId": "${eid}",
  "timeCreated": "${ts}",
  "channel": "audit",
  "level": "info",
  "message": "smoke ingest (direct) — t25",
  "service": "smoke",
  "requestId": "${REQID}",
  "path": "/api/log/v1/logs",
  "method": "POST",
  "v": 1
}
JSON

  # POST — expect 202 and { accepted: N }
  local resp code body
  resp=$(env -u http_proxy -u https_proxy \
    curl -sS -w '\n%{http_code}' -X POST "$BASE" \
      --connect-timeout 2 \
      --max-time "$NV_CURL_MAXTIME" \
      -H "$AUTH" \
      -H "Content-Type: application/json" \
      -H "X-Request-Id: ${REQID}" \
      -H "Expect:" \
      -d "$PAYLOAD")
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"

  # Print body (pretty if possible)
  if [[ ${NV_USE_JQ:-1} -eq 1 ]] && command -v jq >/dev/null 2>&1; then
    echo "$body" | jq
  else
    echo "$body"
  fi

  if [[ "$code" != "202" ]]; then
    echo "❌ expected 202 from POST $BASE, got $code" >&2
    return 1
  fi

  if command -v jq >/dev/null 2>&1; then
    local accepted
    accepted=$(echo "$body" | jq -r '.accepted // 0')
    if [[ "$accepted" -lt 1 ]]; then
      echo "❌ accepted count < 1" >&2
      return 1
    fi
  fi

  echo "✅ log ingest accepted (eventId=${eid})"
}

register_test 25 "log ingest direct (POST /api/log/v1/logs, 4006)" t25
