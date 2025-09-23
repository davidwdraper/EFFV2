#!/usr/bin/env bash
# scripts/smoke/tests/028-jwks-health.sh
# NowVibin — Smoke #028: JWKS endpoint health & schema (with KMS preflight)
#
# WHAT THIS CHECKS
#   1) KMS preflight (from local env): key exists, purpose=ASYMMETRIC_SIGN, has PRIMARY or at least one ENABLED version
#   2) GET /.well-known/jwks.json through the gateway and validate:
#      - HTTP 200
#      - JSON body with non-empty "keys" array
#      - Each key has kid, kty (RSA|EC), use="sig", alg in allowed set
#      - RSA: n & e;  EC: crv in {P-256,P-384,P-521} and x & y
#      - Cache headers present: Cache-Control or ETag
#
# INPUTS
#   - Uses GW from smoke.lib.sh (default http://127.0.0.1:4000)
#   - KMS_* (env) or falls back to backend/services/gateway/.env.dev for preflight:
#       KMS_PROJECT_ID, KMS_LOCATION_ID, KMS_KEY_RING_ID, KMS_KEY_ID
#
# EXIT CODES
#   0 = pass
#   2 = HTTP error calling JWKS
#   3 = bad content-type or schema
#   4 = no keys or invalid keys
#   5 = missing cache headers
#   20 = KMS preflight: purpose not ASYMMETRIC_SIGN
#   21 = KMS preflight: no PRIMARY and no ENABLED versions
#   22 = KMS preflight: KMS describe failed or missing env

set -euo pipefail

# --- local helpers -----------------------------------------------------------
_pretty(){ if command -v jq >/dev/null 2>&1; then jq .; else cat; fi; }

_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$_here/../../.." && pwd)"
DEFAULT_GATEWAY_ENV="$REPO_ROOT/backend/services/gateway/.env.dev"
ENVFILE="${GATEWAY_ENV:-$DEFAULT_GATEWAY_ENV}"

_load_kms_env() {
  local need=0
  [[ -z "${KMS_PROJECT_ID:-}"  ]] && need=1
  [[ -z "${KMS_LOCATION_ID:-}" ]] && need=1
  [[ -z "${KMS_KEY_RING_ID:-}" ]] && need=1
  [[ -z "${KMS_KEY_ID:-}"      ]] && need=1
  if [[ $need -eq 1 && -f "$ENVFILE" ]]; then set -a; . "$ENVFILE"; set +a; fi
  : "${KMS_PROJECT_ID:?KMS_PROJECT_ID is required (env or $ENVFILE)}"
  : "${KMS_LOCATION_ID:?KMS_LOCATION_ID is required (env or $ENVFILE)}"
  : "${KMS_KEY_RING_ID:?KMS_KEY_RING_ID is required (env or $ENVFILE)}"
  : "${KMS_KEY_ID:?KMS_KEY_ID is required (env or $ENVFILE)}"
}

_get_access_token() {
  if command -v gcloud >/dev/null 2>&1; then
    if tok="$(gcloud auth application-default print-access-token 2>/dev/null)"; then printf '%s' "$tok"; return 0; fi
    if tok="$(gcloud auth print-access-token 2>/dev/null)"; then printf '%s' "$tok"; return 0; fi
  fi
  echo "ERROR: No GCP credentials (ADC or gcloud)." >&2
  return 1
}

_pick_enabled_version() {
  # Prints the full resource name of the newest ENABLED version, or empty.
  local key_base="$1" token="$2"
  local list_base="https://cloudkms.googleapis.com/v1/${key_base}/cryptoKeyVersions"
  local tmp; tmp="$(mktemp -t jwksver.XXXXXX)"
  local hdr; hdr="$(mktemp -t jwksver.h.XXXXXX)"
  local status
  status="$(curl -sS -G \
    --data-urlencode 'filter=state=ENABLED' \
    --data-urlencode 'orderBy=name desc' \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: application/json" \
    -D "$hdr" \
    -o "$tmp" \
    -w '%{http_code}' \
    "$list_base")" || status="000"
  if [[ "$status" != "200" ]]; then
    rm -f "$tmp" "$hdr"
    printf ''  # empty
    return 1
  fi
  local ver=""
  if command -v jq >/dev/null 2>&1; then
    ver="$(jq -r '.cryptoKeyVersions[0].name // empty' < "$tmp")"
  else
    ver="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp" | head -n1)"
  fi
  rm -f "$tmp" "$hdr"
  printf '%s' "$ver"
}

# --- main test ---------------------------------------------------------------
t28_jwks_health() {
  # KMS preflight (helps explain 500s quickly)
  _load_kms_env
  local base="projects/${KMS_PROJECT_ID}/locations/${KMS_LOCATION_ID}/keyRings/${KMS_KEY_RING_ID}/cryptoKeys/${KMS_KEY_ID}"
  local key_url="https://cloudkms.googleapis.com/v1/${base}"
  local token; token="$(_get_access_token)"

  echo "— KMS preflight key: ${base}"

  local tmpkey; tmpkey="$(mktemp -t jwkskey.XXXXXX)"
  local status
  status="$(curl -sS -o "$tmpkey" -w '%{http_code}' \
    -H "Authorization: Bearer ${token}" -H "Accept: application/json" "$key_url")"
  if [[ "$status" != "200" ]]; then
    echo "❌ KMS describe failed ($status)"; cat "$tmpkey" | _pretty; rm -f "$tmpkey"; return 22
  fi

  local purpose primary
  if command -v jq >/dev/null 2>&1; then
    purpose="$(jq -r '.purpose // empty' < "$tmpkey")"
    primary="$(jq -r '.primary.name // empty' < "$tmpkey")"
  else
    purpose="$(sed -n 's/.*"purpose"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmpkey" | head -n1)"
    primary="$(sed -n 's/.*"primary"[^{]*{[^}]*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmpkey" | head -n1)"
  fi
  rm -f "$tmpkey"

  if [[ "$purpose" != "ASYMMETRIC_SIGN" ]]; then
    echo "❌ KMS purpose is ${purpose:-<empty>}, needs ASYMMETRIC_SIGN for JWKS"; return 20
  fi

  if [[ -z "$primary" ]]; then
    local picked; picked="$(_pick_enabled_version "$base" "$token" || true)"
    if [[ -z "$picked" ]]; then
      echo "❌ No PRIMARY and no ENABLED versions found on signing key"; return 21
    else
      echo "— No PRIMARY; newest ENABLED exists at: ${picked##*/} (JWKS may still work if gateway chooses same)"
    fi
  else
    echo "— PRIMARY version present: ${primary##*/}"
  fi

  # JWKS request through gateway
  local url="${GW%/}/.well-known/jwks.json"
  echo "— GET ${url}"

  local hdr tmp
  hdr="$(mktemp -t jwks-h.XXXXXX)"
  tmp="$(mktemp -t jwks-b.XXXXXX)"
  cleanup(){ rm -f "${hdr:-}" "${tmp:-}"; }; trap cleanup EXIT

  # Use gateway_req to include edge headers; JWKS should be public-safe anyway
  status="$(gateway_req GET "$url" -D "$hdr" -o "$tmp" -w '%{http_code}')" || status="000"

  # Print body for visibility
  cat "$tmp" | _pretty
  echo

  # HTTP OK?
  if [[ "$status" != "200" ]]; then
    echo "❌ JWKS HTTP status != 200 ($status)"; return 2
  fi

  # Content-Type JSON?
  local ctype
  ctype="$(awk 'BEGIN{IGNORECASE=1}/^Content-Type:/{print tolower($0)}' "$hdr" | tr -d '\r')"
  if ! echo "$ctype" | grep -q 'application/json'; then
    echo "❌ Content-Type not application/json: ${ctype:-<missing>}"; return 3
  fi

  # keys[] schema
  if command -v jq >/dev/null 2>&1; then
    local keycount invalid
    keycount="$(jq -r '(.keys | length) // 0' "$tmp")"
    if [[ "$keycount" -lt 1 ]]; then
      echo "❌ JWKS has no keys"; return 4
    fi
    invalid="$(jq -r '
      def alg_ok(a): a == "RS256" or a == "RS384" or a == "RS512"
                   or a == "PS256" or a == "PS384" or a == "PS512"
                   or a == "ES256" or a == "ES384" or a == "ES512";
      def crv_ok(c): c == "P-256" or c == "P-384" or c == "P-521";

      .keys
      | map(
          (has("kid") and (.kid | type=="string") and (.kid|length>0))
          and (has("kty") and (.kty=="RSA" or .kty=="EC"))
          and (has("use") and .use=="sig")
          and (has("alg") and alg_ok(.alg))
          and ( if .kty=="RSA" then (has("n") and ( .n|type=="string") and (.n|length>0))
                                and (has("e") and ( .e|type=="string") and (.e|length>0))
                else (has("crv") and crv_ok(.crv))
                  and (has("x") and ( .x|type=="string") and (.x|length>0))
                  and (has("y") and ( .y|type=="string") and (.y|length>0))
                end )
        )
      | any(. == false)
    ' "$tmp")"
    if [[ "$invalid" == "true" ]]; then
      echo "❌ One or more JWKs invalid/missing fields"; return 4
    fi
  else
    grep -q '"keys"' "$tmp" || { echo "❌ JWKS missing 'keys'"; return 4; }
    grep -q '"kid"' "$tmp"  || { echo "❌ JWKS missing 'kid'";  return 4; }
  fi

  # Caching headers
  local cc etag
  cc="$(awk 'BEGIN{IGNORECASE=1}/^Cache-Control:/{print $0}' "$hdr" | tr -d '\r')"
  etag="$(awk 'BEGIN{IGNORECASE=1}/^ETag:/{print $0}' "$hdr" | tr -d '\r')"
  if [[ -z "$cc" && -z "$etag" ]]; then
    echo "❌ Neither Cache-Control nor ETag present on JWKS response"; return 5
  fi
  if [[ -n "$cc" ]] && ! echo "$cc" | grep -qi 'max-age='; then
    echo "⚠️  Cache-Control present but missing max-age: $cc"
  fi

  echo "✅ JWKS healthy: HTTP 200, schema OK, caching headers present"
  return 0
}

register_test 28 "jwks health & schema (gateway) + KMS preflight" t28_jwks_health
