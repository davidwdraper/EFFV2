# /scripts/smoke/tests/024_log_health_direct.sh
#!/usr/bin/env bash
: "${LOG_URL:=http://127.0.0.1:4006}"
: "${LOG_HEALTH_PATH:=/health}"
: "${NV_CURL_MAXTIME:=5}"

t24() {
  set -euo pipefail
  local url="${LOG_URL%/}${LOG_HEALTH_PATH}"

  # No -v, no stderr capture → body stays clean JSON
  local resp code body
  resp=$(env -u http_proxy -u https_proxy \
    curl -sS --ipv4 --connect-timeout 2 --max-time "$NV_CURL_MAXTIME" \
         -w '\n%{http_code}' "$url")
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"

  # Must be 200
  if [[ "$code" != "200" ]]; then
    echo "$body"
    echo "❌ health not 200 at $url (got $code)" >&2
    return 1
  fi

  # If jq is enabled, require valid JSON; otherwise just echo raw
  if [[ ${NV_USE_JQ:-1} -eq 1 ]] && command -v jq >/dev/null 2>&1; then
    if ! echo "$body" | jq -e . >/dev/null 2>&1; then
      echo "$body"
      echo "❌ health body is not valid JSON" >&2
      return 1
    fi
    echo "$body" | jq
  else
    echo "$body"
  fi

  echo "✅ health OK at $url"
  return 0
}

register_test 24 "log health direct (127.0.0.1:4006)" t24
