# PATH: scripts/smoke/tests/010_act_crud_gateway_withaddr.sh
#!/usr/bin/env bash
# Act create/get/delete VIA GATEWAY (4000) WITH address → triggers Act→Geo geocode via callBySlug.
# Conforms to APR-0029 (versioned edge route) and gateway auth requirements.
#
# Requirements:
#   - All calls go through the gateway: $GW (default http://127.0.0.1:4000)
#   - Versioned route: /api/act.V1/acts   (slug singular + versioned)
#   - Gateway enforces mutations require X-NV-User-Assertion (provided by gateway_req headers).
#   - svcconfig LKG includes geo + act with outboundApiPrefix=/api.
#   - Act uses callBySlug to call Geo at GEO_RESOLVE_PATH=/resolve and returns {lat,lng}.

t10() {
  set -euo pipefail

  # ---- Config ---------------------------------------------------------------
  local base="${GW:-http://127.0.0.1:4000}/api/act.V1/acts"
  local max_time="${NV_CURL_MAXTIME:-15}"

  # ---- Minimal helpers (namespaced to avoid collisions) ---------------------
  t10_unique_suffix() {
    local ts rand
    ts=$(date +%Y%m%d%H%M%S)
    rand=$( (openssl rand -hex 3 2>/dev/null) || printf '%04d' "$RANDOM" )
    printf '%s-%s' "$ts" "$rand"
  }

  t10_payload_with_address_named() {
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

  # ---- Create (PUT via gateway, with proper headers) ------------------------
  local nm="SmokeTest Act $(t10_unique_suffix)"
  local resp id
  resp=$(
    gateway_req PUT "$base" \
      --max-time "$max_time" \
      -H "Content-Type: application/json" \
      -d "$(t10_payload_with_address_named "$nm")"
  )

  if [[ "${NV_USE_JQ:-1}" -eq 1 ]] && command -v "${JQ:-jq}" >/dev/null 2>&1; then
    echo "$resp" | ${JQ:-jq}
  else
    echo "$resp"
  fi

  # Extract id
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
  code=$(gateway_req DELETE "$base/$id" --max-time "${NV_CURL_MAXTIME:-12}" -o /dev/null -w '%{http_code}')
  case "$code" in
    200|202|204|404) echo "✅ delete $base/$id ($code)";;
    *) echo "❌ delete $base/$id failed ($code)"; exit 1;;
  esac
}

register_test 10 "act PUT+GET+DELETE via gateway WITH address → geocode" t10
