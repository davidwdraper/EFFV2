#!/usr/bin/env bash
# scripts/smoke/smoke.lib.sh
#
# Shared helpers for modular smoketests (one file per test)
# macOS Bash 3.2 compatible (no associative arrays, no mapfile)

# ---- Globals / defaults -----------------------------------------------------
# Store tests as "id|name|func" strings
TESTS=()   # bash 3.2-friendly

# Endpoints (override via env)
GW=${GW:-http://127.0.0.1:4000}
CORE=${CORE:-http://127.0.0.1:4011}
GEO=${GEO:-http://127.0.0.1:4012}
ACT=${ACT:-http://127.0.0.1:4002}
USER_URL=${USER_URL:-http://127.0.0.1:4001}  # ← renamed (avoid clash with shell $USER)

# S2S defaults (must match backend .env.dev)
S2S_JWT_SECRET="${S2S_JWT_SECRET:-devlocal-core-internal}"
S2S_JWT_AUDIENCE="${S2S_JWT_AUDIENCE:-internal-services}"

# End-user assertion defaults (dev/test)
# These mirror the backend expectation:
#   - HS256 shared secret across gateway, core, and services
#   - aud=internal-users
#   - iss=gateway (edge) or gateway-core (core hop)
USER_ASSERTION_SECRET="${USER_ASSERTION_SECRET:-devlocal-users-internal}"
USER_ASSERTION_AUDIENCE="${USER_ASSERTION_AUDIENCE:-internal-users}"
USER_ASSERTION_ISSUER_CORE="${USER_ASSERTION_ISSUER_CORE:-gateway-core}"
USER_ASSERTION_ISSUER_GATEWAY="${USER_ASSERTION_ISSUER_GATEWAY:-gateway}"

# Data defaults
GEO_ADDRESS="${GEO_ADDRESS:-1600 Amphitheatre Parkway, Mountain View, CA}"
MAIL_ADDR1="${MAIL_ADDR1:-36100 Date Palm Drive}"
MAIL_ADDR2="${MAIL_ADDR2:-}"
MAIL_CITY="${MAIL_CITY:-Cathedral City}"
MAIL_STATE="${MAIL_STATE:-CA}"
MAIL_ZIP="${MAIL_ZIP:-92234}"

# CLI toggles
NV_USE_JQ=${NV_USE_JQ:-1}
NV_QUIET=${NV_QUIET:-0}
JQ=${JQ:-jq}
if [[ $NV_USE_JQ -eq 1 ]] && ! command -v "$JQ" >/dev/null 2>&1; then
  echo "jq not found, falling back to raw output"; NV_USE_JQ=0
fi

# ---- Utilities --------------------------------------------------------------
pretty() { if [[ ${NV_USE_JQ:-1} -eq 1 ]]; then "$JQ"; else cat; fi; }
json() { printf '%s' "$1"; }

# base64url (no padding)
b64url() { openssl enc -base64 -A | tr '+/' '-_' | tr -d '='; }

# ---- Tokens -----------------------------------------------------------------
# S2S HS256 mint (compact JWT)
# p1: iss, p2: svc, p3: ttl
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

# Convenience: tokens used by tests
TOKEN_CORE()       { mint_s2s "gateway-core" "gateway-core" 300; }  # core→worker S2S
TOKEN_CALLER_ACT() { mint_s2s "internal" "act" 300; }               # pretend "act" client
TOKEN_GATEWAY() { mint_s2s "gateway" "gateway" 300; }

# End-user assertion (compact JWT) — issuer = gateway-core
mint_user_assertion_core() {
  local uid="${1:-smoke-tests}" ttl="${2:-300}"
  local now exp jti hdr pld sig
  now=$(date +%s); exp=$((now + ttl))
  jti=$(openssl rand -hex 16 2>/dev/null)
  hdr='{"alg":"HS256","typ":"JWT"}'
  pld=$(printf '{"sub":"%s","iss":"%s","aud":"%s","iat":%s,"exp":%s,"jti":"%s"}' \
        "$uid" "$USER_ASSERTION_ISSUER_CORE" "$USER_ASSERTION_AUDIENCE" "$now" "$exp" "$jti")
  hdr=$(printf '%s' "$hdr" | b64url)
  pld=$(printf '%s' "$pld" | b64url)
  sig=$(printf '%s.%s' "$hdr" "$pld" | openssl dgst -binary -sha256 -hmac "$USER_ASSERTION_SECRET" | b64url)
  printf '%s.%s.%s' "$hdr" "$pld" "$sig"
}
ASSERT_USER() { mint_user_assertion_core "${1:-smoke-tests}" "${2:-300}"; }

# End-user assertion — issuer = gateway (public gateway)
mint_user_assertion_gateway() {
  local uid="${1:-smoke-tests}" ttl="${2:-300}"
  local now exp jti hdr pld sig
  now=$(date +%s); exp=$((now + ttl))
  jti=$(openssl rand -hex 16 2>/dev/null)
  hdr='{"alg":"HS256","typ":"JWT"}'
  pld=$(printf '{"sub":"%s","iss":"%s","aud":"%s","iat":%s,"exp":%s,"jti":"%s"}' \
        "$uid" "$USER_ASSERTION_ISSUER_GATEWAY" "$USER_ASSERTION_AUDIENCE" "$now" "$exp" "$jti")
  hdr=$(printf '%s' "$hdr" | b64url)
  pld=$(printf '%s' "$pld" | b64url)
  sig=$(printf '%s.%s' "$hdr" "$pld" | openssl dgst -binary -sha256 -hmac "$USER_ASSERTION_SECRET" | b64url)
  printf '%s.%s.%s' "$hdr" "$pld" "$sig"
}
ASSERT_USER_GATEWAY() { mint_user_assertion_gateway "${1:-smoke-tests}" "${2:-300}"; }

# ---- Safe header emitters (space-escaped for command substitution) ----------
# Usage example:
#   curl $(AUTH_HEADERS_CORE) "$URL"
# or:
#   curl $(AUTH_HEADERS_GATEWAY) "$URL"
#
# We escape spaces in header values so command substitution does not break them.
AUTH_HEADERS_CORE() {
  printf '%s ' \
    -H "Authorization:\ Bearer\ $(TOKEN_CORE)" \
    -H "X-NV-User-Assertion:\ $(ASSERT_USER smoke-tests 300)"
}
AUTH_HEADERS_GATEWAY() {
  printf '%s ' \
    -H "Authorization:\ Bearer\ $(TOKEN_GATEWAY)" \
    -H "X-NV-User-Assertion:\ $(ASSERT_USER_GATEWAY smoke-tests 300)"
}

# ---- JSON helpers -----------------------------------------------------------
extract_id() { ${JQ} -r '._id // .id // .data._id // empty'; }

delete_ok() {
  local url="$1"; shift
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$url" "$@")
  case "$code" in
    200|202|204|404) echo "✅ delete $url ($code)";;
    *) echo "❌ delete $url failed ($code)"; exit 1;;
  esac
}

# Example payloads used by Act tests
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
      \"addr1\": \"${MAIL_ADDR1}\",
      \"addr2\": \"${MAIL_ADDR2}\",
      \"city\": \"${MAIL_CITY}\",
      \"state\": \"${MAIL_STATE}\",
      \"zip\": \"${MAIL_ZIP}\"
    }
  }"
}

# ---- Registration & Runner --------------------------------------------------
register_test() {
  local id="$1" name="$2" fn="$3"
  # prevent duplicate IDs by linear scan (Bash 3.2-safe)
  local row tid
  for row in "${TESTS[@]}"; do
    IFS='|' read -r tid _ _ <<<"$row"
    if [[ "$tid" == "$id" ]]; then
      echo "Duplicate test id: $id ($name)" >&2; exit 1
    fi
  done
  TESTS+=("${id}|${name}|${fn}")
}

nv_sort_tests() {
  if [[ ${#TESTS[@]} -le 1 ]]; then return; fi
  local tmp=() sorted=() line i id
  for i in "${!TESTS[@]}"; do
    IFS='|' read -r id _ _ <<<"${TESTS[$i]}"
    tmp+=("${id}|${i}")
  done
  local sorted_idx=()
  while IFS= read -r line; do sorted_idx+=("${line#*|}"); done < <(printf "%s\n" "${tmp[@]}" | LC_ALL=C sort -n -t '|' -k1,1)
  for i in "${sorted_idx[@]}"; do sorted+=("${TESTS[$i]}"); done
  TESTS=("${sorted[@]}")
}

nv_print_list() {
  printf "Available tests:\n"
  local row id name
  for row in "${TESTS[@]}"; do
    IFS='|' read -r id name _ <<<"$row"
    printf "  %2s) %s\n" "$id" "$name"
  done
}

nv_help() {
  cat <<EOF
Usage: bash scripts/smoke/smoke.sh [--list] [--no-jq] [--silent] <id|id,id|id-id|all>

Env overrides:
  GW=http://127.0.0.1:4000
  CORE=http://127.0.0.1:4011
  GEO=http://127.0.0.1:4012
  ACT=http://127.0.0.1:4002
  USER_URL=http://127.0.0.1:4001   # ← user service base URL

Options:
  --list     Show enumerated tests and exit
  --no-jq    Disable jq pretty-print (raw output)
  --silent   Only print: [PASSED|FAILED] <num> <name> (and exit non-zero on any failure)
EOF
}

nv_parse_selection() {
  local sel="$1" out=()
  if [[ "$sel" == "all" ]]; then
    local row id
    for row in "${TESTS[@]}"; do IFS='|' read -r id _ _ <<<"$row"; out+=("$id"); done
  else
    IFS=',' read -ra parts <<<"$sel"
    local p a b i
    for p in "${parts[@]}"; do
      if [[ "$p" =~ ^[0-9]+-[0-9]+$ ]]; then
        a="${p%-*}"; b="${p#*-}"; for ((i=a; i<=b; i++)); do out+=("$i"); done
      elif [[ "$p" =~ ^[0-9]+$ ]]; then out+=("$p")
      else echo "Bad selection token: $p" >&2; exit 64
      fi
    done
  fi
  printf "%s\n" "${out[@]}"
}

_nv_find_index_by_id() {
  local want="$1" row id i=0
  for row in "${TESTS[@]}"; do
    IFS='|' read -r id _ _ <<<"$row"
    if [[ "$id" == "$want" ]]; then echo "$i"; return 0; fi
    i=$((i+1))
  done
  echo ""; return 1
}

nv_run_one() {
  local id="$1" idx
  idx=$(_nv_find_index_by_id "$id") || true
  if [[ -z "$idx" ]]; then echo "Unknown test id: $id" >&2; return 64; fi
  IFS='|' read -r _ name fn <<<"${TESTS[$idx]}"

  if [[ ${NV_QUIET:-0} -eq 1 ]]; then
    local rc; set +e; "$fn" >/dev/null 2>&1; rc=$?; set -e
    if [[ $rc -eq 0 ]]; then printf "[PASSED] %s %s\n" "$id" "$name"; else printf "[FAILED] %s %s\n" "$id" "$name"; fi
    return $rc
  else
    printf "\n===== [%s] %s =====\n" "$id" "$name"
    "$fn"
  fi
}
