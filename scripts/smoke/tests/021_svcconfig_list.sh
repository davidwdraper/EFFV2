#!/usr/bin/env bash
# 21 — svcconfig list services
# Lists the registered services from svcconfig’s API (S2S-protected).
# Uses CORE-style S2S headers from smoke.lib.sh.

t21() {
  local SVC="${SVC:-${SVCCONFIG_URL:-http://127.0.0.1:4013}}"
  local url="$SVC/api/svcconfig/services"

  # S2S auth + user assertion (array form: NV_AUTH_HEADERS[@])
  AUTH_HEADERS_CORE_ARR

  echo "-- $url"
  curl -fsS "$url" "${NV_AUTH_HEADERS[@]}" | pretty
}

register_test 21 "svcconfig list services" t21
