# /scripts/smoke/tests/009_act_crud_direct_withaddr.sh
#!/usr/bin/env bash
# Act create/get/delete DIRECT (4002) WITH address → triggers Act→Geo geocode via clientHttp.
# Self-contained: does NOT rely on TOKEN_* helpers (since they may be absent).
# It mints an S2S JWT inline here using env S2S_JWT_SECRET / S2S_JWT_AUDIENCE.

t9() {
  set -euo pipefail

  # ---- Config ---------------------------------------------------------------
  local base="${ACT:-<direct-disabled>}/api/acts"
  local max_time="${NV_CURL_MAXTIME:-15}"

  # Defaults must match backend .env.dev
  local S2S_SECRET="${S2S_JWT_SECRET:-devlocal-s2s-secret}"
  local S2S_AUD="${S2S_JWT_AUDIENCE:-internal-services}"

  # ---- Minimal helpers (self-contained; don’t depend on smoke.lib.sh) -------
  b64url() { openssl enc -base64 -A | tr '+/' '-_' | tr -d '='; }

  mint_s2s_inline() {
    # $1=iss  $2=svc  $3=ttl
    local iss="${1:-gateway}" svc="${2:-gateway}" ttl="${3:-300}"
    local now exp hdr pld sig
    now=$(date +%s); exp=$((now + ttl))
    hdr='{"alg":"HS256","typ":"JWT"}'
    pld=$(printf '{"sub":"s2s","iss":"%s","aud":"%s","iat":%s,"exp":%s,"svc":"%s"}' \
          "$iss" "$S2S_AUD" "$now" "$exp" "$svc")
    hdr=$(printf '%s' "$hdr" | b64url)
    pld=$(printf '%s' "$pld" | b64url)
    sig=$(printf '%s.%s' "$hdr" "$pld" | \
          openssl dgst -binary -sha256 -hmac "$S2S_SECRET" | b64url)
    printf '%s.%s.%s' "$hdr" "$pld" "$sig"
  }

  unique_suffix() {
    local ts rand
    ts=$(date +%Y%m%d%H%M%S)
    rand=$( (openssl rand -hex 3 2>/dev/null) || printf '%04d' "$RANDOM" )
    printf '%s-%s' "$ts" "$rand"
  }

  # Build JSON payload with mailingAddress and unique name to avoid E11000
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

  # ---- Mint caller→Act S2S (gateway issuer is acceptable in dev smokes) -----
  local TOKEN; TOKEN="$(mint_s2s_inline "gateway" "gateway" 300)"
  local AUTH="Authorization: Bearer ${TOKEN}"

  # ---- Create (PUT) ---------------------------------------------------------
  local nm="SmokeTest Act $(unique_suffix)"
  local resp id
  resp=$(curl -sS -X PUT "$base" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    --max-time "$max_time" \
    -d "$(payload_with_address_named "$nm")")

  if [[ "${NV_USE_JQ:-1}" -eq 1 ]] && command -v "${JQ:-jq}" >/dev/null 2>&1; then
    echo "$resp" | ${JQ:-jq}
  else
    echo "$resp"
  fi

  # Extract id
  if command -v jq >/dev/null 2>&1; then
    id=$(echo "$resp" | jq -r '._id // .id // .data._id // .result._id // empty')
  else
    # crude fallback: not perfect, but adequate for smoke
    id=$(echo "$resp" | sed -n 's/.*"_id"[[:space:]]*:[[:space:]]*"\([^"]\+\)".*/\1/p' | head -n1)
  fi

  [[ -n "${id:-}" ]] || { echo "❌ direct PUT+address did not return _id (name=$nm)"; exit 1; }
  echo "✅ created direct _id=$id (name=$nm)"

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

  # ---- GET (read-back) ------------------------------------------------------
  curl -sS "$base/$id" -H "$AUTH" --max-time "${NV_CURL_MAXTIME:-12}" | {
    if command -v jq >/dev/null 2>&1; then jq; else cat; fi
  }

  # ---- DELETE (cleanup; idempotent) -----------------------------------------
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$base/$id" -H "$AUTH" --max-time "${NV_CURL_MAXTIME:-12}")
  case "$code" in
    200|202|204|404) echo "✅ delete $base/$id ($code)";;
    *) echo "❌ delete $base/$id failed ($code)"; exit 1;;
  esac
}

register_test 9 "act PUT+GET+DELETE direct WITH address → geocode (JWT gateway)" t9
