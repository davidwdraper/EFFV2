# /scripts/smoke/tests/006_geo_resolve_via_core.sh
#!/usr/bin/env bash
t6() {
  local TOKEN; TOKEN=$(TOKEN_CALLER_ACT)
  curl -sS -X POST "$CORE/api/geo/resolve" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(json "{\"address\":\"$GEO_ADDRESS\"}")" | pretty
}
register_test 6 "geo resolve via gateway-core (4011, JWT act)" t6
