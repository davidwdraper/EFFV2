# /scripts/smoke/tests/013_user_crud_direct.sh
#!/usr/bin/env bash
# User PUT+GET+DELETE DIRECT (4001) — plural /api/users
# Self-contained: mints S2S + user assertion locally (no smoke.lib header helpers).

t13() {
  set -euo pipefail

  # ---- Config ---------------------------------------------------------------
  local BASE="${USER_URL:-<direct-disabled>}/api/users"
  local MAX_TIME="${NV_CURL_MAXTIME:-15}"

  # S2S / user assertion env (defaults mirror dev)
  local S2S_SECRET="${S2S_JWT_SECRET:-devlocal-s2s-secret}"
  local S2S_AUD="${S2S_JWT_AUDIENCE:-internal-services}"
  local UA_SECRET="${USER_ASSERTION_SECRET:-devlocal-users-internal}"
  local UA_AUD="${USER_ASSERTION_AUDIENCE:-internal-users}"
  local UA_ISS="${USER_ASSERTION_ISSUER_GATEWAY:-gateway}"

  # ---- Tiny JWT mint (HS256) ------------------------------------------------
  b64url() { openssl enc -base64 -A | tr '+/' '-_' | tr -d '='; }
  mint_hs256() {
    # $1=secret $2=payload-json
    local secret="$1" pld="$2" hdr sig
    hdr='{"alg":"HS256","typ":"JWT"}'
    hdr=$(printf '%s' "$hdr" | b64url)
    pld=$(printf '%s' "$pld" | b64url)
    sig=$(printf '%s.%s' "$hdr" "$pld" | openssl dgst -binary -sha256 -hmac "$secret" | b64url)
    printf '%s.%s.%s' "$hdr" "$pld" "$sig"
  }
  now() { date +%s; }

  mint_s2s_gateway() {
    local n exp; n=$(now); exp=$((n+300))
    mint_hs256 "$S2S_SECRET" "$(printf '{"sub":"s2s","iss":"gateway","aud":"%s","exp":%s,"svc":"user"}' "$S2S_AUD" "$exp")"
  }
  mint_user_assertion() {
    local sub="${1:-smoke-tests}" n exp jti
    n=$(now); exp=$((n+300)); jti=$(openssl rand -hex 16 2>/dev/null)
    mint_hs256 "$UA_SECRET" "$(printf '{"sub":"%s","iss":"%s","aud":"%s","iat":%s,"exp":%s,"jti":"%s"}' "$sub" "$UA_ISS" "$UA_AUD" "$n" "$exp" "$jti")"
  }

  # ---- Headers --------------------------------------------------------------
  if ! command -v openssl >/dev/null 2>&1; then
    echo "❌ openssl required"; exit 1
  fi
  AUTH="Authorization: Bearer $(mint_s2s_gateway)"
  UA="X-NV-User-Assertion: $(mint_user_assertion smoke-tests)"

  # ---- Helpers --------------------------------------------------------------
  unique() { printf '%s-%s' "$(date +%Y%m%d%H%M%S)" "$(openssl rand -hex 3 2>/dev/null || echo $RANDOM)"; }
  pretty() { if [[ ${NV_USE_JQ:-1} -eq 1 ]] && command -v jq >/dev/null 2>&1; then jq; else cat; fi; }

  payload_user_minimal_named() {
    local uname="$1" uemail="$2" first="$3" last="$4"
    cat <<JSON
{
  "displayName": "${uname}",
  "firstname": "${first}",
  "lastname": "${last}",
  "email": "${uemail}",
  "roles": [],
  "scopes": []
}
JSON
  }

  # ---- CREATE ---------------------------------------------------------------
  local suf name email first last resp id
  suf="$(unique)"
  first="Smoke${suf}"
  last="User"
  name="SmokeTest User ${suf}"
  email="smoke+${suf}@example.test"

  resp=$(curl -sS -X PUT "$BASE" \
    --max-time "$MAX_TIME" \
    -H "$AUTH" -H "$UA" -H "Content-Type: application/json" \
    -d "$(payload_user_minimal_named "$name" "$email" "$first" "$last")")
  echo "$resp" | pretty

  if command -v jq >/dev/null 2>&1; then
    id=$(echo "$resp" | jq -r '._id // .id // .data._id // .result._id // empty')
  else
    id=$(echo "$resp" | sed -n 's/.*"_id"[[:space:]]*:[[:space:]]*"\([^"]\+\)".*/\1/p' | head -n1)
  fi
  [[ -n "${id:-}" ]] || { echo "❌ direct PUT did not return id/_id"; exit 1; }
  echo "✅ created direct _id=$id (email=$email)"

  # ---- GET ------------------------------------------------------------------
  curl -sS "$BASE/$id" --max-time "$MAX_TIME" -H "$AUTH" -H "$UA" | pretty

  # ---- DELETE (idempotent) --------------------------------------------------
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/$id" \
    --max-time "$MAX_TIME" \
    -H "$AUTH" -H "$UA")
  case "$code" in
    200|202|204|404) echo "✅ delete $BASE/$id ($code)";;
    *) echo "❌ delete $BASE/$id failed ($code)"; exit 1;;
  esac
}

register_test 13 "user PUT+GET+DELETE direct (4001) — plural /api/users" t13
