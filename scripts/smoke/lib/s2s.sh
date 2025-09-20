# /scripts/smoke/lib/s2s.sh
#!/usr/bin/env bash
# S2S + User Assertion minting (single source of truth)
# WHY:
# - Centralizes token minting used by gateway-first tests.
# - Mirrors production helper behavior (HS256 dev path only).

set -euo pipefail

# ---- Auth plane env (names only; values from .env.*) ------------------------
S2S_JWT_SECRET="${S2S_JWT_SECRET:-devlocal-s2s-secret}"
S2S_JWT_ISSUER="${S2S_JWT_ISSUER:-gateway}"
S2S_JWT_AUDIENCE="${S2S_JWT_AUDIENCE:-internal-services}"
S2S_CLOCK_SKEW_SEC="${S2S_CLOCK_SKEW_SEC:-60}"

USER_ASSERTION_SECRET="${USER_ASSERTION_SECRET:-devlocal-users-internal}"
USER_ASSERTION_ISSUER="${USER_ASSERTION_ISSUER:-gateway}"
USER_ASSERTION_AUDIENCE="${USER_ASSERTION_AUDIENCE:-internal-users}"
USER_ASSERTION_CLOCK_SKEW_SEC="${USER_ASSERTION_CLOCK_SKEW_SEC:-30}"

# Default service-caller identity (gateway | act | user | audit | geo | …)
SMOKE_S2S_CALLER="${SMOKE_S2S_CALLER:-gateway}"

# ---- Base64URL helpers ------------------------------------------------------
_b64url() { openssl enc -base64 -A | tr '+/' '-_' | tr -d '='; }
_b64url_decode() { tr '_-' '/+' | base64 -D 2>/dev/null || base64 -d 2>/dev/null; }

# ---- S2S Mint ---------------------------------------------------------------
s2s_token() {
  local caller="${1:-$SMOKE_S2S_CALLER}" ttl="${2:-300}"
  local now exp hdr pld sig
  now=$(date +%s); exp=$((now + ttl))
  hdr='{"alg":"HS256","typ":"JWT"}'
  pld=$(printf '{"sub":"s2s","iss":"%s","aud":"%s","iat":%s,"exp":%s,"svc":"%s"}' \
        "$S2S_JWT_ISSUER" "$S2S_JWT_AUDIENCE" "$now" "$exp" "$caller")
  hdr=$(printf '%s' "$hdr" | _b64url)
  pld=$(printf '%s' "$pld" | _b64url)
  sig=$(printf '%s.%s' "$hdr" "$pld" | openssl dgst -binary -sha256 -hmac "$S2S_JWT_SECRET" | _b64url)
  printf '%s.%s.%s' "$hdr" "$pld" "$sig"
}

# ---- User Assertion Mint (gateway semantics) --------------------------------
user_assertion() {
  local sub="${1:-smoke-tests}" ttl="${2:-300}"
  local now exp jti hdr pld sig
  now=$(date +%s); exp=$((now + ttl))
  jti=$(openssl rand -hex 16 2>/dev/null)
  hdr='{"alg":"HS256","typ":"JWT"}'
  pld=$(printf '{"sub":"%s","iss":"%s","aud":"%s","iat":%s,"exp":%s,"jti":"%s"}' \
        "$sub" "$USER_ASSERTION_ISSUER" "$USER_ASSERTION_AUDIENCE" "$now" "$exp" "$jti")
  hdr=$(printf '%s' "$hdr" | _b64url)
  pld=$(printf '%s' "$pld" | _b64url)
  sig=$(printf '%s.%s' "$hdr" "$pld" | openssl dgst -binary -sha256 -hmac "$USER_ASSERTION_SECRET" | _b64url)
  printf '%s.%s.%s' "$hdr" "$pld" "$sig"
}
