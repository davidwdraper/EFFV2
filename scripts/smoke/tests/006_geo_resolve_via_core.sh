# scripts/smoke/tests/006_geo_resolve_via_core.sh
#!/usr/bin/env bash
t6() {
  # Build tokens explicitly so we can pass them with real shell quoting.
  local TOKEN UA
  TOKEN="$(TOKEN_CORE)"                    # iss=gateway-core, signed with S2S_JWT_SECRET
  UA="$(ASSERT_USER smoke-tests 300)"      # user assertion, signed with USER_ASSERTION_SECRET

  curl -sS -X POST "$CORE/api/geo/resolve" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-NV-User-Assertion: $UA" \
    -H "Content-Type: application/json" \
    -d "$(json "{\"address\":\"$GEO_ADDRESS\"}")" | pretty
}
register_test 6 "geo resolve via gateway-core (4011, S2S+user assertion)" t6
