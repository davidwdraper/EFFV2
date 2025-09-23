#!/usr/bin/env bash
# NowVibin — Smoke #027: KMS “runtime-style” verify (no OpenSSL), primary-optional
#
# WHAT IT DOES
#   - ASYMMETRIC_SIGN → sign via KMS, verify in Node crypto (mirrors prod)
#   - ENCRYPT_DECRYPT → encrypt/decrypt round-trip
#
# BEHAVIOR
#   - Loads KMS_* from env, falls back to backend/services/gateway/.env.dev
#   - If CryptoKey.primary is missing, auto-picks newest ENABLED version (URL-encoded list)
#   - Uses correct public key endpoint: /cryptoKeyVersions/<N>/publicKey
#
# REQUIREMENTS
#   - gcloud/ADC available
#   - Perms: viewer + signerVerifier (sign path) / cryptoKeyEncrypterDecrypter (enc/dec path)

set -euo pipefail

# --- repo/env ---------------------------------------------------------------
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

_b64(){ base64 | tr -d '\n'; }
_b64d(){ base64 -d 2>/dev/null || base64 -D 2>/dev/null; }
_pretty(){ if command -v jq >/dev/null 2>&1; then jq .; else cat; fi; }
_hash_from_algo(){ case "$1" in *SHA256*)echo sha256;; *SHA384*)echo sha384;; *SHA512*)echo sha512;; *)echo sha256;; esac; }

# --- Node verify (no OpenSSL) ----------------------------------------------
_node_verify() {
  node - <<'NODE'
const { readFileSync } = require('fs');
const { createVerify } = require('crypto');
const pem  = process.env.NV_PEM;
const hash = (process.env.NV_HASH || 'sha256').toLowerCase();
const msgP = process.env.NV_MSG;
const sigP = process.env.NV_SIG;
if (!pem || !msgP || !sigP) { console.error("Missing NV_PEM/NV_MSG/NV_SIG"); process.exit(2); }
const data = readFileSync(msgP);
const sig  = readFileSync(sigP);
const v = createVerify(hash);
v.update(data); v.end();
if (!v.verify(pem, sig)) { console.error("verify=false"); process.exit(3); }
console.log("verify=true");
NODE
}

# --- robust version picker (URL-encoded) ------------------------------------
_pick_enabled_version() {
  # Prints the full resource name of the newest ENABLED version, or empty.
  local key_base="$1" token="$2"
  local list_base="https://cloudkms.googleapis.com/v1/${key_base}/cryptoKeyVersions"
  local tmp; tmp="$(mktemp -t kmslist.XXXXXX)"
  local hdr; hdr="$(mktemp -t kmslist.h.XXXXXX)"
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
    echo "❌ list versions failed ($status)" >&2
    sed -n '1,50p' "$hdr" >&2 || true
    cat "$tmp" | _pretty >&2 || true
    rm -f "$tmp" "$hdr"
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

# --- main -------------------------------------------------------------------
t27_kms_runtime_verify() {
  _load_kms_env
  local base="projects/${KMS_PROJECT_ID}/locations/${KMS_LOCATION_ID}/keyRings/${KMS_KEY_RING_ID}/cryptoKeys/${KMS_KEY_ID}"
  local key_url="https://cloudkms.googleapis.com/v1/${base}"
  local token; token="$(_get_access_token)"

  local tmp_key="" tmp_ver="" tmp_pub="" msg="" sigbin="" tmp_enc="" tmp_dec="" pt=""
  cleanup(){ rm -f "${tmp_key:-}" "${tmp_ver:-}" "${tmp_pub:-}" "${msg:-}" "${sigbin:-}" "${tmp_enc:-}" "${tmp_dec:-}" "${pt:-}"; }
  trap cleanup EXIT

  # Key metadata
  tmp_key="$(mktemp -t kmskey.XXXXXX)"
  local status
  status="$(curl -sS -o "$tmp_key" -w '%{http_code}' \
    -H "Authorization: Bearer ${token}" -H "Accept: application/json" "$key_url")"
  [[ "$status" == "200" ]] || { echo "❌ GET CryptoKey failed ($status)"; cat "$tmp_key"|_pretty; return 2; }

  local purpose primary
  if command -v jq >/dev/null 2>&1; then
    purpose="$(jq -r '.purpose // empty' < "$tmp_key")"
    primary="$(jq -r '.primary.name // empty' < "$tmp_key")"
  else
    purpose="$(sed -n 's/.*"purpose"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp_key" | head -n1)"
    primary="$(sed -n 's/.*"primary"[^{]*{[^}]*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp_key" | head -n1)"
  fi

  if [[ "$purpose" == "ASYMMETRIC_SIGN" ]]; then
    # Choose primary or newest ENABLED
    local version_name=""
    if [[ -n "$primary" ]]; then
      version_name="$primary"
      echo "— Purpose: ASYMMETRIC_SIGN (using PRIMARY)"
    else
      version_name="$(_pick_enabled_version "$base" "$token")" || version_name=""
      [[ -n "$version_name" ]] || { echo "❌ No primary and no ENABLED versions found"; return 3; }
      echo "— Purpose: ASYMMETRIC_SIGN (auto-pick ENABLED version)"
    fi
    echo "— Using version: ${version_name##*/}"
    local version_url="https://cloudkms.googleapis.com/v1/${version_name}"

    # Algo
    tmp_ver="$(mktemp -t kmsver.XXXXXX)"
    status="$(curl -sS -o "$tmp_ver" -w '%{http_code}' \
      -H "Authorization: Bearer ${token}" -H "Accept: application/json" "$version_url")"
    [[ "$status" == "200" ]] || { echo "❌ GET version failed ($status)"; cat "$tmp_ver"|_pretty; return 4; }
    local algo; if command -v jq >/dev/null 2>&1; then algo="$(jq -r '.algorithm // empty' < "$tmp_ver")"; else algo="$(sed -n 's/.*"algorithm"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp_ver" | head -n1)"; fi
    [[ -n "$algo" ]] || { echo "❌ No algorithm on version"; return 4; }
    local hash; hash="$(_hash_from_algo "$algo")"

    # Message + digest
    msg="$(mktemp -t kmsmsg.XXXXXX)"; printf 'NV smoke 027 — %s\n' "$(date -u +%FT%TZ)" > "$msg"
    local digest_b64 sign_field body
    case "$hash" in sha256)sign_field='"sha256"';; sha384)sign_field='"sha384"';; sha512)sign_field='"sha512"';; esac
    digest_b64="$(openssl dgst -$hash -binary "$msg" | _b64)"
    body=$(printf '{ "digest": { %s: "%s" } }' "$sign_field" "$digest_b64")

    # Sign
    local tmp_sign; tmp_sign="$(mktemp -t kmssig.XXXXXX)"
    status="$(curl -sS -o "$tmp_sign" -w '%{http_code}' \
      -H "Authorization: Bearer ${token}" -H "Accept: application/json" \
      -H "Content-Type: application/json" -X POST --data "$body" \
      "${version_url}:asymmetricSign")"
    cat "$tmp_sign"|_pretty
    [[ "$status" == "200" ]] || { echo "❌ asymmetricSign failed ($status)"; return 5; }
    local sig_b64; if command -v jq >/dev/null 2>&1; then sig_b64="$(jq -r '.signature // empty' < "$tmp_sign")"; else sig_b64="$(sed -n 's/.*"signature"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp_sign" | head -n1)"; fi
    [[ -n "$sig_b64" ]] || { echo "❌ No signature in response"; return 5; }
    sigbin="$(mktemp -t sigbin.XXXXXX)"; printf '%s' "$sig_b64" | _b64d > "$sigbin"

    # Public key
    tmp_pub="$(mktemp -t kmspub.XXXXXX)"
    status="$(curl -sS -o "$tmp_pub" -w '%{http_code}' \
      -H "Authorization: Bearer ${token}" -H "Accept: application/json" \
      "${version_url}/publicKey")"
    [[ "$status" == "200" ]] || { echo "❌ getPublicKey failed ($status)"; cat "$tmp_pub"|_pretty; return 6; }
    local pem; if command -v jq >/dev/null 2>&1; then pem="$(jq -r '.pem // empty' < "$tmp_pub")"; else pem="$(awk '/"pem":/ {p=1; next} p {print} /-----END PUBLIC KEY-----/ {exit}' "$tmp_pub" | sed 's/\\"/"/g' | tr -d '\r' | sed 's/^ *"//; s/" *,*$//')"; fi
    [[ -n "$pem" ]] || { echo "❌ No PEM in response"; return 6; }

    NV_PEM="$pem" NV_HASH="$hash" NV_MSG="$msg" NV_SIG="$sigbin" _node_verify >/dev/null
    echo "✅ Node verify OK"
    return 0
  fi

  if [[ "$purpose" == "ENCRYPT_DECRYPT" ]]; then
    # Symmetric round-trip
    pt="$(mktemp -t pt.XXXXXX)"; printf 'NV smoke 027 enc — %s\n' "$(date -u +%FT%TZ)" > "$pt"
    local pt_b64; pt_b64="$(cat "$pt" | _b64)"

    tmp_enc="$(mktemp -t kmsenc.XXXXXX)"
    local body_enc; body_enc=$(printf '{ "plaintext": "%s" }' "$pt_b64")
    status="$(curl -sS -o "$tmp_enc" -w '%{http_code}' \
      -H "Authorization: Bearer ${token}" -H "Accept: application/json" \
      -H "Content-Type: application/json" -X POST --data "$body_enc" \
      "${key_url}:encrypt")"
    cat "$tmp_enc"|_pretty
    [[ "$status" == "200" ]] || { echo "❌ encrypt failed ($status)"; return 9; }
    local ct_b64; if command -v jq >/dev/null 2>&1; then ct_b64="$(jq -r '.ciphertext // empty' < "$tmp_enc")"; else ct_b64="$(sed -n 's/.*"ciphertext"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp_enc" | head -n1)"; fi
    [[ -n "$ct_b64" ]] || { echo "❌ No ciphertext in response"; return 9; }

    tmp_dec="$(mktemp -t kmsdec.XXXXXX)"
    local body_dec; body_dec=$(printf '{ "ciphertext": "%s" }' "$ct_b64")
    status="$(curl -sS -o "$tmp_dec" -w '%{http_code}' \
      -H "Authorization: Bearer ${token}" -H "Accept: application/json" \
      -H "Content-Type: application/json" -X POST --data "$body_dec" \
      "${key_url}:decrypt")"
    cat "$tmp_dec"|_pretty
    [[ "$status" == "200" ]] || { echo "❌ decrypt failed ($status)"; return 10; }
    local pt_out_b64; if command -v jq >/dev/null 2>&1; then pt_out_b64="$(jq -r '.plaintext // empty' < "$tmp_dec")"; else pt_out_b64="$(sed -n 's/.*"plaintext"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp_dec" | head -n1)"; fi
    [[ -n "$pt_out_b64" ]] || { echo "❌ No plaintext in decrypt response"; return 10; }
    local round; round="$(mktemp -t round.XXXXXX)"; printf '%s' "$pt_out_b64" | _b64d > "$round"

    diff -u "$pt" "$round" >/dev/null 2>&1 || { echo "❌ Round-trip mismatch"; echo "---- sent ----"; cat "$pt"; echo "---- got  ----"; cat "$round"; return 11; }
    echo "✅ KMS encrypt + decrypt round-trip OK"
    return 0
  fi

  echo "❌ Unsupported key purpose: $purpose"
  return 12
}

register_test 27 "google kms runtime-style verify (sign or enc/dec)" t27_kms_runtime_verify
