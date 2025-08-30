#!/usr/bin/env bash
# smoke.sh — curl smoketests for gateway / core / act / geo
#
# Usage:
#   bash smoke.sh --list
#   bash smoke.sh <id|id,id|id-id|all>  [--no-jq]
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

# S2S minting defaults (match your .env.dev)
S2S_JWT_SECRET="${S2S_JWT_SECRET:-devlocal-core-internal}"
S2S_JWT_AUDIENCE="${S2S_JWT_AUDIENCE:-internal-services}"

# Data defaults
GEO_ADDRESS="${GEO_ADDRESS:-1600 Amphitheatre Parkway, Mountain View, CA}"
MAIL_ADDR1="${MAIL_ADDR1:-}"
MAIL_ADDR2="${MAIL_ADDR2:-}"
MAIL_CITY="${MAIL_CITY:-}"
MAIL_STATE="${MAIL_STATE:-}"
MAIL_ZIP="${MAIL_ZIP:-}"

USE_JQ=1
[[ "${1-}" == "--no-jq" ]] && USE_JQ=0 && shift || true
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
TOKEN_CALLER_ACT() { mint_s2s "internal" "act" 300; }               # act→core

# ─────────────────────────────────────────────────────────────────────────────
# JSON helpers
json() { printf '%s' "$1"; }

payload_act_minimal() {
  json '{
    "name": "SmokeTest Act Update",
    "websiteUrl": "https://example.test/smoke",
    "tags": ["smoke","update"]
  }'
}

payload_act_with_address() {
  local a1="${MAIL_ADDR1}" a2="${MAIL_ADDR2}" c="${MAIL_CITY}" s="${MAIL_STATE}" z="${MAIL_ZIP}"
  json "{
    \"name\": \"SmokeTest Act Update With Address\",
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

# ─────────────────────────────────────────────────────────────────────────────
# Test definitions
declare -a TESTS=(
  "1|gateway health|t1"
  "2|gateway-core health|t2"
  "3|act health|t3"
  "4|geo health|t4"
  "5|geo resolve direct (4012, JWT core)|t5"
  "6|geo resolve via gateway-core (4011, JWT act)|t6"
  "7|act PUT direct (4002) no address (JWT core)|t7"
  "8|act PUT via gateway (4000) no address (JWT act)|t8"
  "9|act PUT direct (4002) WITH address → geocode (JWT core)|t9"
  "10|act PUT via gateway (4000) WITH address → geocode (JWT act)|t10"
)

# ─────────────────────────────────────────────────────────────────────────────
# Tests

t1() { curl -sS "$GW/health/live" | pretty; }
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
  curl -sS -X PUT "$ACT/acts" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(payload_act_minimal)" | pretty
}

t8() {
  local TOKEN; TOKEN=$(TOKEN_CALLER_ACT)
  curl -sS -X PUT "$GW/act/acts" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(payload_act_minimal)" | pretty
}

t9() {
  if [[ -z "${MAIL_ADDR1}${MAIL_CITY}${MAIL_STATE}${MAIL_ZIP}" ]]; then
    echo "⚠️  Provide MAIL_ADDR1/MAIL_CITY/MAIL_STATE/MAIL_ZIP to trigger geocode." >&2
  fi
  local TOKEN; TOKEN=$(TOKEN_CORE)
  curl -sS -X PUT "$ACT/acts" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(payload_act_with_address)" | pretty
}

t10() {
  if [[ -z "${MAIL_ADDR1}${MAIL_CITY}${MAIL_STATE}${MAIL_ZIP}" ]]; then
    echo "⚠️  Provide MAIL_ADDR1/MAIL_CITY/MAIL_STATE/MAIL_ZIP to trigger geocode." >&2
  fi
  local TOKEN; TOKEN=$(TOKEN_CALLER_ACT)
  curl -sS -X PUT "$GW/act/acts" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(payload_act_with_address)" | pretty
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
Usage: bash smoke.sh [--list] [--no-jq] <id|id,id|id-id|all>

Options:
  --list     Show enumerated tests and exit
  --no-jq    Disable jq pretty-print (raw output)

Examples:
  bash smoke.sh --list
  bash smoke.sh 1
  bash smoke.sh 1,3,5-7
  MAIL_ADDR1="1600 Amphitheatre Pkwy" MAIL_CITY="Mountain View" MAIL_STATE=CA MAIL_ZIP=94043 bash smoke.sh 10
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
  if [[ $found -eq 0 ]]; then echo "Unknown test id: $id" >&2; exit 64; fi
  printf "\n===== [%s] %s =====\n" "$id" "$name"
  "$fn"
}

# ─────────────────────────────────────────────────────────────────────────────
# Entry

if [[ "${1-}" == "--list" ]]; then
  print_list
  exit 0
fi

if [[ $# -lt 1 ]]; then
  help
  echo
  print_list   # 👈 show list as a convenience
  exit 64
fi

SELECTION="$1"; shift || true
mapfile -t IDS < <(parse_selection "$SELECTION")

for id in "${IDS[@]}"; do run_one "$id"; done

