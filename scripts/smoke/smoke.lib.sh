# /scripts/smoke/smoke.lib.sh
#!/usr/bin/env bash
#
# Shared helpers for modular smoketests (one file per test)
# macOS Bash 3.2 compatible (no associative arrays, no mapfile)

# ---- Globals / defaults -----------------------------------------------------
TESTS=()   # store as "id|name|func"

# Endpoints (override via env)
GW=${GW:-http://127.0.0.1:4000}
CORE=${CORE:-http://127.0.0.1:4011}
GEO=${GEO:-http://127.0.0.1:4012}
ACT=${ACT:-http://127.0.0.1:4002}
USER_URL=${USER_URL:-http://127.0.0.1:4001}  # avoid clash with $USER

# S2S defaults (must match backend .env.dev)
S2S_JWT_SECRET="${S2S_JWT_SECRET:-devlocal-s2s-secret}"
S2S_JWT_AUDIENCE="${S2S_JWT_AUDIENCE:-internal-services}"

# End-user assertion defaults (dev/test)
USER_ASSERTION_SECRET="${USER_ASSERTION_SECRET:-devlocal-users-internal}"
USER_ASSERTION_AUDIENCE="${USER_ASSERTION_AUDIENCE:-internal-users}"
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
b64url() { openssl enc -base64 -A | tr '+/' '-_' | tr -d '='; }  # base64url
b64url_decode() { tr '_-' '/+' | base64 -D 2>/dev/null || base64 -d 2>/dev/null; }

# Unique suffix for entity names to avoid 11000 (dupe key) across reruns
nv_unique_suffix() {
  local ts rand
  ts=$(date +%Y%m%d%H%M%S)
  rand=$( (openssl rand -hex 3 2>/dev/null) || printf '%04d' "$RANDOM" )
  printf '%s-%s' "$ts" "$rand"
}

# ---- Tokens -----------------------------------------------------------------
mint_s2s () {
  local iss="${1:-gateway}" svc="${2:-smoke}" ttl="${3:-300}"
  local now exp hdr pld sig
  now=$(date +%s); exp=$((now + ttl))
  hdr='{"alg":"HS256","typ":"JWT"}'
  # include iat (some verifiers require it)
  pld=$(printf '{"sub":"s2s","iss":"%s","aud":"%s","iat":%s,"exp":%s,"svc":"%s"}' \
        "$iss" "$S2S_JWT_AUDIENCE" "$now" "$exp" "$svc")
  hdr=$(printf '%s' "$hdr" | b64url)
  pld=$(printf '%s' "$pld" | b64url)
  sig=$(printf '%s.%s' "$hdr" "$pld" | openssl dgst -binary -sha256 -hmac "$S2S_JWT_SECRET" | b64url)
  printf '%s.%s.%s' "$hdr" "$pld" "$sig"
}

# Issuer selection:
# - Default caller is gateway (edge→worker).
# - For service→service, set SMOKE_S2S_CALLER=<slug> (act|user|geo|audit|...)
SMOKE_S2S_CALLER="${SMOKE_S2S_CALLER:-gateway}"

_smoke_s2s_token_for() {
  local caller="${1:-$SMOKE_S2S_CALLER}"
  mint_s2s "$caller" "$caller" 300
}

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

# ---- SAFE header emitters (array form — use these) --------------------------
# These populate NV_AUTH_HEADERS[@] with:
#   -H "Authorization: Bearer <...>"  -H "X-NV-User-Assertion: <...>"
AUTH_HEADERS_SVC_ARR() {
  local caller="${1:-$SMOKE_S2S_CALLER}"
  NV_AUTH_HEADERS=(
    -H "Authorization: Bearer $(_smoke_s2s_token_for "$caller")"
    -H "X-NV-User-Assertion: $(ASSERT_USER_GATEWAY smoke-tests 300)"
  )
}

# ---- Unified request wrappers ----------------------------------------------
# nv_req [METHOD] [URL] [CALLER?] [extra curl args...]
# CALLER defaults to $SMOKE_S2S_CALLER (default: gateway)
nv_req() {
  local method="$1"; shift
  local url="$1"; shift || true
  local caller="${1-}"; if [[ "$caller" =~ ^-H|^-d|^-X|^-s|^-- ]]; then caller=""; else shift || true; fi
  AUTH_HEADERS_SVC_ARR "${caller:-$SMOKE_S2S_CALLER}"
  curl -sS -X "$method" "$url" "${NV_AUTH_HEADERS[@]}" "$@"
}

# Convenience for explicit gateway caller
nv_req_gateway() {
  local method="$1"; shift
  local url="$1"; shift || true
  nv_req "$method" "$url" "gateway" "$@"
}

# ---- Debug helpers ----------------------------------------------------------
nv_dbg_show_s2s() {
  local caller="${1:-$SMOKE_S2S_CALLER}"
  local tok; tok="$(_smoke_s2s_token_for "$caller")"
  local h p; h="${tok%%.*}"; p="${tok#*.}"; p="${p%%.*}"
  echo "— S2S DEBUG —"
  echo "caller=${caller} secret(len)=${#S2S_JWT_SECRET} aud=${S2S_JWT_AUDIENCE}"
  echo "header:"; printf '%s' "$h" | b64url_decode | pretty
  echo "payload:"; printf '%s' "$p" | b64url_decode | pretty
}

# ---- Audit diag helpers -----------------------------------------------------
nv_audit_diag_json() { curl -sS "${GW%/}/__audit" || true; }
nv_audit_current_file() {
  if [[ ${NV_USE_JQ:-1} -eq 1 ]] && command -v "${JQ:-jq}" >/dev/null 2>&1; then
    nv_audit_diag_json | "${JQ:-jq}" -r '.currentFile // empty' >/dev/null 2>&1 || true
  else
    nv_audit_diag_json | sed -n 's/.*"currentFile"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
  fi
}
nv_file_bytes() { wc -c < "$1" 2>/dev/null || echo 0; }

# ---- JSON helpers -----------------------------------------------------------
extract_id() { ${JQ} -r '._id // .id // .data._id // .data.id // .result._id // .result.id // empty'; }

delete_ok() {
  local url="$1"; shift
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$url" "$@")
  case "$code" in
    200|202|204|404) echo "✅ delete $url ($code)"; return 0;;
    *) echo "❌ delete $url failed ($code)"; return 1;;
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

payload_act_minimal_named() {
  local nm="$1"
  json "{
    \"name\": \"${nm}\",
    \"websiteUrl\": \"https://example.test/smoke\",
    \"tags\": [\"smoke\",\"update\"],
    \"actLoc\": { \"type\": \"Point\", \"coordinates\": [-122.084, 37.422] },

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
    \"numberOfBreaks\": 1
  }"
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
  USER_URL=http://127.0.0.1:4001   # user service base URL

Test tuning:
  SMOKE_S2S_CALLER=gateway|act|user|geo|audit|...   (default: gateway)
  S2S_JWT_SECRET=...           # must match service verifier
  S2S_JWT_AUDIENCE=...         # must match service verifier

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

nv_name_for_id() {
  local id="$1" idx
  idx=$(_nv_find_index_by_id "$id") || true
  if [[ -z "$idx" ]]; then printf "Unknown"; return 0; fi
  IFS='|' read -r _ name _ <<<"${TESTS[$idx]}"
  printf "%s" "$name"
}

nv_run_one() {
  local id="$1" idx rc
  idx=$(_nv_find_index_by_id "$id") || true
  if [[ -z "$idx" ]]; then echo "Unknown test id: $id" >&2; return 64; fi
  IFS='|' read -r _ name fn <<<"${TESTS[$idx]}"

  if [[ ${NV_QUIET:-0} -eq 1 ]]; then
    ( set +e; "$fn" >/dev/null 2>&1 ); rc=$?
    return $rc
  else
    printf "\n===== [%s] %s =====\n" "$id" "$name"
    ( set +e; "$fn" ); rc=$?
    if [[ $rc -ne 0 ]]; then
      printf "❌ FAILED [%s] %s (rc=%s)\n" "$id" "$name" "$rc"
    else
      printf "✅ PASSED [%s] %s\n" "$id" "$name"
    fi
    return $rc
  fi
}
