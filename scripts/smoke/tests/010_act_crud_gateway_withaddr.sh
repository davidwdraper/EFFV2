# /scripts/smoke/tests/010_act_crud_gateway_withaddr.sh
#!/usr/bin/env bash
# Act create/get/delete VIA GATEWAY (4000) WITH address → triggers Act→Geo geocode via clientHttp.
# This mirrors test #9 but calls through the gateway:
#   - Base URL: $GW (default <direct-disabled>)
#   - Route:    /api/act/acts  (slug singular + plural route)
# Assumptions:
#   - Gateway injects S2S + user assertion upstream (no client auth required here).
#   - svcconfig LKG includes geo + act with outboundApiPrefix=/api.
#   - GEO_RESOLVE_PATH=/resolve in Act env.
#   - Shared client in Act makes S2S call to Geo and returns {lat,lng}.

t10() {
  set -euo pipefail

  # ---- Config ---------------------------------------------------------------
  local base="${GW:-<direct-disabled>}/api/act/acts"
  local max_time="${NV_CURL_MAXTIME:-15}"

  # ---- Minimal helpers (self-contained) -------------------------------------
  unique_suffix() {
    local ts rand
    ts=$(date +%Y%m%d%H%M%S)
    rand=$( (openssl rand -hex 3 2>/dev/null) || printf '%04d' "$RANDOM" )
    printf '%s-%s' "$ts" "$rand"
  }

  payload_with_address_named() {
    local name="$1"
    cat <<JSON
{
  "name": "${name}",
  "websiteUrl": "https://example.test/smoke",
  "tags": ["smoke","update"],
  "userCreateId": "mock-user-id",
  "userOwnerId": "mock-user-id",
  "homeTown": "Mountain View",
  "state": "CA",
  "homeTownId": "mock-town-id",
  "actType": [1],
  "genreList": ["rock"],
  "blackoutDays": [false, false, false, false, false, false, false],
  "actDuration": 60,
  "breakLength": 15,
  "numberOfBreaks": 1,
  "mailingAddress": {
    "addr1": "${MAIL_ADDR1:-36100 Date Palm Drive}",
    "addr2": "${MAIL_ADDR2:-}",
    "city":  "${MAIL_CITY:-Cathedral City}",
    "state": "${MAIL_STATE:-CA}",
    "zip":   "${MAIL_ZIP:-92234}"
  }
}
JSON
  }

  # ---- Create (PUT via gateway) --------------------------------------------
  local nm="SmokeTest Act $(unique_suffix)"
  local resp id
  resp=$(curl -sS -X PUT "$base" \
    -H "Content-Type: application/json" \
    --max-time "$max_time" \
    -d "$(payload_with_address_named "$nm")")

  if [[ "${NV_USE_JQ:-1}" -eq 1 ]] && command -v "${JQ:-jq}" >/dev/null 2>&1; then
    echo "$resp" | ${JQ:-jq}
  else
    echo "$resp"
  fi

  # Extract id (prefer jq if present)
  if command -v jq >/dev/null 2>&1; then
    id=$(echo "$resp" | jq -r '._id // .id // .data._id // .result._id // empty')
  else
    id=$(echo "$resp" | sed -n 's/.*"_id"[[:space:]]*:[[:space:]]*"\([^"]\+\)".*/\1/p' | head -n1)
  fi

  [[ -n "${id:-}" ]] || { echo "❌ gateway PUT+address did not return _id (name=$nm)"; exit 1; }
  echo "✅ created via gateway _id=$id (name=$nm)"

  # ---- Geocode assertion: expect coordinates [lng, lat] ---------------------
  local lng lat
  if command -v jq >/dev/null 2>&1; then
    lng=$(echo "$resp" | jq -r '.actLoc.coordinates[0] // empty')
    lat=$(echo "$resp" | jq -r '.actLoc.coordinates[1] // empty')
  else
    lng=$(echo "$resp" | sed -n 's/.*"coordinates":[[]\([^,]*\),.*/\1/p' | head -n1)
    lat=$(echo "$resp" | sed -n 's/.*"coordinates":[[][^,]*,\([^]]*\).*/\1/p' | head -n1)
  fi

  if [[ -z "$lat" || -z "$lng" ]]; then
    echo "❌ expected geocoded coordinates on create (lat/lng missing)"; exit 1;
  fi
  echo "✅ geocoded coordinates present (lng=$lng lat=$lat)"

  # ---- GET (read-back via gateway) ------------------------------------------
  curl -sS "$base/$id" --max-time "${NV_CURL_MAXTIME:-12}" | {
    if command -v jq >/dev/null 2>&1; then jq; else cat; fi
  }

  # ---- DELETE (cleanup; idempotent via gateway) ------------------------------
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$base/$id" --max-time "${NV_CURL_MAXTIME:-12}")
  case "$code" in
    200|202|204|404) echo "✅ delete $base/$id ($code)";;
    *) echo "❌ delete $base/$id failed ($code)"; exit 1;;
  esac
}

register_test 10 "act PUT+GET+DELETE via gateway WITH address → geocode" t10
