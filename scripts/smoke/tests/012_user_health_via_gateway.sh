# /scripts/smoke/tests/012_user_health_via_gateway.sh
#!/usr/bin/env bash
# user health via gateway (public, non-/api). No auth header, fail on 4xx.
: "${USER_GATEWAY_HEALTH_PATH:=/user/health/live}"

t12() {
  curl -fsS "$GW${USER_GATEWAY_HEALTH_PATH}" | pretty
}
register_test 12 "user health via gateway (4000)" t12
