# scripts/smoke.sh
#!/usr/bin/env bash
# smoke.sh — curl smoketests for gateway / core / act / geo / user
#
# Usage:
#   bash smoke.sh --list
#   bash smoke.sh [--no-jq] [--silent] <id|id,id|id-id|all>
#
# Examples:
#   bash smoke.sh 1
#   bash smoke.sh 6
#   bash smoke.sh 1,3,5-7
#   MAIL_ADDR1="1600 Amphitheatre Pkwy" MAIL_CITY="Mountain View" MAIL_STATE=CA MAIL_ZIP=94043 bash smoke.sh 10
#
# -----------------------------------------------------------------------------
# Adding a new test:
#   1) Write a new function tNN() (where NN is the next number).
#      - Implement the curl call
#      - Pipe to `| pretty` at the end
#   2) Add one entry to the TESTS array below in the format:
#        "NN|human-readable name|tNN"
#   3) That’s it. `--list` will show the new test, and you can run it by number.
# -----------------------------------------------------------------------------

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Config (edit ports/urls if needed)
GW=${GW:-http://127.0.0.1:4000}
CORE=${CORE:-http://127.0.0.1:4011}
GEO=${GEO:-http://127.0.0.1:4012}
ACT=${ACT:-http://127.0.0.1:4002}
USER=${USER:-http://127.0.0.1:4001}

# S2S minting defaults (match your .env.dev)
S2S_JWT_SECRET="${S2S_JWT_SECRET:-devlocal-s2s-secret}"
S2S_JWT_AUDIENCE="${S2S_JWT_AUDIENCE:-internal-services}"

# Data defaults
GEO_ADDRESS="${GEO_ADDRESS:-1600 Amphitheatre Parkway, Mountain View, CA}"
MAIL_ADDR1="${MAIL_ADDR1:-36100 Date Palm Drive}"
MAIL_ADDR2="${MAIL_ADDR2:-}"
MAIL_CITY="${MAIL_CITY:-Cathedral City}"
MAIL_STATE="${MAIL_STATE:-CA}"
MAIL_ZIP="${MAIL_ZIP:-92234}"

USE_JQ=1
QUIET=0

# Flag parsing (order-agnostic)
while [[ "${1-}" == --* ]]; do
  case "${1-}" in
    --no-jq) USE_JQ=0; shift;;
    --silent|--quiet) QUIET=1; shift;;
    --list)  # defer to later (after functions exist)
      break;;
    *) break;;
  esac
done

JQ=${JQ:-jq}
if [[ $USE_JQ -eq 1 ]] && ! command -v "$JQ" >/dev/null 2>&1; then
  echo "jq not found, falling back to raw output"; USE_JQ=0
fi

# ─────────────────────────────────────────────────────────────────────────────
# JWT helpers
b64url() { openssl enc -base64 -A | tr '+/' '-_' | tr -d '='; }
mint_s2s () {
  local iss="${1:-internal}" svc="${2:-act}" ttl="${3:-300}"
  local now exp hdr pld sig
  now=$(date +%s); exp=$((now + ttl))
  hdr='{"alg":"HS256","typ":"JWT"}'
  pld=$(printf '{"sub":"s2s","iss":"%s","aud":"%s","exp":%s,"svc":"%s"}' \
        "$iss" "$S2S_JWT_AUDIENCE" "$exp" "$svc")
  hdr=$(printf '%s' "$hdr" | b64url)
  pld=$(printf '%s' "$pld" | b64url)
  sig=$(printf '%s.%s' "$hdr" "$pld" | openssl dgst -binary -sha256 -hmac "$S2S_JWT_SECRET" | b64url)
  printf '%s.%s.%s' "$hdr" "$pld" "$sig"
}
TOKEN_CORE()       { mint_s2s "gateway-core" "gateway-core" 300; }  # core→worker
TOKEN_CALLER_ACT() { mint_s2s "internal" "act" 300; }               # act→core (client)

# ─────────────────────────────────────────────────────────────────────────────
# JSON helpers
json() { printf '%s' "$1"; }

payload_act_minimal() {
  json '{
    "name": "SmokeTest Act Update",
    "websiteUrl": "https://example.test/smoke",
    "tags": ["smoke","update"],
    "actLoc": { "type": "Point", "coordinates": [-122.084, 37.422] },

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
    "numberOfBreaks": 1
  }'
}

payload_act_with_address() {
  local a1="${MAIL_ADDR1}" a2="${MAIL_ADDR2}" c="${MAIL_CITY}" s="${MAIL_STATE}" z="${MAIL_ZIP}"
  json "{
    \"name\": \"SmokeTest Act Update With Address\",
    \"websiteUrl\": \"https://example.test/smoke\",
    \"tags\": [\"smoke\",\"update\"],

    \"userCreateId\": \"mock-user-id\",
    \"userOwnerId\": \"mock-user-id\",

    \"homeTown\": \"Mountain View\",
    \"state\": \"CA\",
    \"homeTownId\": \"mock-town-id\",

    \"actType\": [1],
    \"genreList\": [\"rock\"],
    \"blackoutDays\": [false, false, false, false, false, false, false],

    \"actDuration\": 60,
    \"breakLength\": 15,
    \"numberOfBreaks\": 1,

    \"mailingAddress\": {
      \"addr1\": \"${a1}\",
      \"addr2\": \"${a2}\",
      \"city\": \"${c}\",
      \"state\": \"${s}\",
      \"zip\": \"${z}\"
    }
  }"
}

pretty() { if [[ $USE_JQ -eq 1 ]]; then "$JQ"; else cat; fi }
extract_id() { ${JQ} -r '._id // .id // .data._id // empty'; }

delete_ok() {
  local url="$1"; shift
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$url" "$@")
  case "$code" in 200|202|204|404) echo "✅ delete $url ($code)";;
    *) echo "❌ delete $url failed ($code)"; exit 1;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# Test definitions
declare -a TESTS=(
  "1|gateway health|t1"
  "2|gateway-core health|t2"
  "3|act health|t3"
  "4|geo health|t4"
  "5|geo resolve direct (4012, JWT core)|t5"
  "6|geo resolve via gateway-core (4011, JWT act)|t6"
  "7|act PUT+GET+DELETE direct (4002) no address (JWT core)|t7"
  "8|act PUT+GET+DELETE via gateway (4000) no address (JWT act)|t8"
  "9|act PUT+GET+DELETE direct (4002) WITH address → geocode (JWT core)|t9"
  "10|act PUT+GET+DELETE via gateway (4000) WITH address → geocode (JWT act)|t10"
  "11|user health direct (4001)|t11"
  "12|user health via gateway (4000, JWT act)|t12"
)

# ─────────────────────────────────────────────────────────────────────────────
# Tests

t1() {
  echo "-- $GW/live";          curl -sS "$GW/live" | pretty
  echo "-- $GW/ready";         curl -sS "$GW/ready" | pretty
  echo "-- $GW/health/live";   curl -sS "$GW/health/live" | pretty
  echo "-- $GW/health/ready";  curl -sS "$GW/health/ready" | pretty
  echo "-- $GW/healthz";       curl -sS "$GW/healthz" | pretty
  echo "-- $GW/readyz";        curl -sS "$GW/readyz" | pretty
}

t2() { curl -sS "$CORE/health/live" | pretty; }
t3() { curl -sS "$ACT/health/live" | pretty; }
t4() { curl -sS "$GEO/health/live" | pretty; }

t5() {
  local TOKEN; TOKEN=$(TOKEN_CORE)
  curl -sS -X POST "$GEO/resolve" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(json "{\"address\":\"$GEO_ADDRESS\"}")" | pretty
}

t6() {
  local TOKEN; TOKEN=$(TOKEN_CALLER_ACT)
  curl -sS -X POST "$CORE/api/geo/resolve" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(json "{\"address\":\"$GEO_ADDRESS\"}")" | pretty
}

t7() {
  local TOKEN; TOKEN=$(TOKEN_CORE)
  local base="$ACT/api/acts"
  local resp id
  resp=$(curl -sS -X PUT "$base" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(payload_act_minimal)")
  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ direct PUT did not return _id"; exit 1; }
  echo "✅ created direct _id=$id"
  curl -sS -H "Authorization: Bearer $TOKEN" "$base/$id" | pretty
  delete_ok "$base/$id" -H "Authorization: Bearer $TOKEN"
}

t8() {
  local TOKEN; TOKEN=$(TOKEN_CALLER_ACT)
  local base="$GW/api/act/acts"
  local resp id
  resp=$(curl -sS -X PUT "$base" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(payload_act_minimal)")
  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ gateway PUT did not return _id"; exit 1; }
  echo "✅ created via gateway _id=$id"
  curl -sS -H "Authorization: Bearer $TOKEN" "$base/$id" | pretty
  delete_ok "$base/$id" -H "Authorization: Bearer $TOKEN"
}

t9() {
  if [[ -z "${MAIL_ADDR1}${MAIL_CITY}${MAIL_STATE}${MAIL_ZIP}" ]]; then
    echo "⚠️  Provide MAIL_ADDR1/MAIL_CITY/MAIL_STATE/MAIL_ZIP to trigger geocode." >&2
  fi
  local TOKEN; TOKEN=$(TOKEN_CORE)
  local base="$ACT/api/acts"
  local resp id
  resp=$(curl -sS -X PUT "$base" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(payload_act_with_address)")
  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ direct PUT+address did not return _id"; exit 1; }
  echo "✅ created direct(with addr) _id=$id"
  curl -sS -H "Authorization: Bearer $TOKEN" "$base/$id" | pretty
  delete_ok "$base/$id" -H "Authorization: Bearer $TOKEN"
}

t10() {
  if [[ -z "${MAIL_ADDR1}${MAIL_CITY}${MAIL_STATE}${MAIL_ZIP}" ]]; then
    echo "⚠️  Provide MAIL_ADDR1/MAIL_CITY/MAIL_STATE/MAIL_ZIP to trigger geocode." >&2
  fi
  local TOKEN; TOKEN=$(TOKEN_CALLER_ACT)
  local base="$GW/api/act/acts"
  local resp id
  resp=$(curl -sS -X PUT "$base" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(payload_act_with_address)")
  echo "$resp" | pretty
  id=$(echo "$resp" | extract_id)
  [[ -n "$id" ]] || { echo "❌ gateway PUT+address did not return _id"; exit 1; }
  echo "✅ created via gateway(with addr) _id=$id"
  curl -sS -H "Authorization: Bearer $TOKEN" "$base/$id" | pretty
  delete_ok "$base/$id" -H "Authorization: Bearer $TOKEN"
}

t11() { curl -sS "$USER/health/live" | pretty; }

t12() {
  local TOKEN; TOKEN=$(TOKEN_CALLER_ACT)
  curl -sS "$GW/api/user/health/live" \
    -H "Authorization: Bearer $TOKEN" | pretty
}

# ─────────────────────────────────────────────────────────────────────────────
# Runner plumbing

print_list() {
  printf "Available tests:\n"
  for row in "${TESTS[@]}"; do
    IFS='|' read -r id name fn <<<"$row"
    printf "  %2s) %s\n" "$id" "$name"
  done
}

help() {
  cat <<EOF
Usage: bash smoke.sh [--list] [--no-jq] [--silent] <id|id,id|id-id|all>

Options:
  --list     Show enumerated tests and exit
  --no-jq    Disable jq pretty-print (raw output)
  --silent   Only print: [PASSED|FAILED] <num> <name> (and exit non-zero on any failure)

Examples:
  bash smoke.sh --list
  bash smoke.sh 1
  bash smoke.sh 1,3,5-7
  MAIL_ADDR1="36100 Date Palm Drive" MAIL_CITY="Cathedral City" MAIL_STATE=CA MAIL_ZIP=92234 bash smoke.sh 10
EOF
}

parse_selection() {
  local sel="$1" out=()
  if [[ "$sel" == "all" ]]; then
    for row in "${TESTS[@]}"; do IFS='|' read -r id _ _ <<<"$row"; out+=("$id"); done
  else
    IFS=',' read -ra parts <<<"$sel"
    for p in "${parts[@]}"; do
      if [[ "$p" =~ ^[0-9]+-[0-9]+$ ]]; then
        local a b; a="${p%-*}"; b="${p#*-}"
        for ((i=a; i<=b; i++)); do out+=("$i"); done
      elif [[ "$p" =~ ^[0-9]+$ ]]; then
        out+=("$p")
      else
        echo "Bad selection token: $p" >&2; exit 64
      fi
    done
  fi
  printf "%s\n" "${out[@]}"
}

run_one() {
  local id="$1"
  local found=0 name fn
  for row in "${TESTS[@]}"; do
    IFS='|' read -r tid name fn <<<"$row"
    if [[ "$tid" == "$id" ]]; then found=1; break; fi
  done
  if [[ $found -eq 0 ]]; then echo "Unknown test id: $id" >&2; return 64; fi

  if [[ $QUIET -eq 1 ]]; then
    local rc
    set +e
    "${fn}" >/dev/null 2>&1
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      printf "[PASSED] %s %s\n" "$id" "$name"
    else
      printf "[FAILED] %s %s\n" "$id" "$name"
    fi
    return $rc
  else
    printf "\n===== [%s] %s =====\n" "$id" "$name"
    "${fn}"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Entry (portable: no mapfile/process substitution)
if [[ "${1-}" == "--list" ]]; then
  print_list
  exit 0
fi

if [[ $# -lt 1 ]]; then
  help
  echo
  print_list
  exit 64
fi

SELECTION="$1"; shift || true

# Build IDS[] without mapfile or < <(...) to support macOS Bash 3.2
IDS=()
_selection_expanded="$(parse_selection "$SELECTION")"
while IFS= read -r line; do
  [[ -n "$line" ]] && IDS+=("$line")
done <<< "$_selection_expanded"
unset _selection_expanded

if [[ $QUIET -eq 1 ]]; then
  overall=0
  for id in "${IDS[@]}"; do
    if ! run_one "$id"; then overall=1; fi
  done
  exit $overall
else
  for id in "${IDS[@]}"; do run_one "$id"; done
fi
