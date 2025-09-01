# /scripts/smoke/tests/005_geo_resolve_direct.sh
#!/usr/bin/env bash
t5() {
  local TOKEN; TOKEN=$(TOKEN_CORE)
  curl -sS -X POST "$GEO/resolve" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(json "{\"address\":\"$GEO_ADDRESS\"}")" | pretty
}
register_test 5 "geo resolve direct (4012, JWT core)" t5
