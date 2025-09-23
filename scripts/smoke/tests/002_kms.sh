#!/usr/bin/env bash
# NowVibin — Smoke #002: Google KMS connectivity (read-only)
#
# WHY:
#   Baby-step sanity check: can we reach Google Cloud KMS and read CryptoKey
#   metadata? No sign/encrypt—just a GET.
#
# NOTES:
#   - Prefers KMS_* from environment (CI/unmanned).
#   - Falls back to loading backend/services/gateway/.env.dev.
#   - Robust path resolution from THIS file (works no matter where you run smoke.sh).
#   - Pass if HTTP 200 and .name == expected key path.

set -euo pipefail

# --- repo root & default env path (robust from this file) --------------------
_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# tests -> smoke -> scripts -> repo root
REPO_ROOT="$(cd "$_here/../../.." && pwd)"
DEFAULT_GATEWAY_ENV="$REPO_ROOT/backend/services/gateway/.env.dev"

# Allow override: export GATEWAY_ENV=/abs/path/to/.env.dev
ENVFILE="${GATEWAY_ENV:-$DEFAULT_GATEWAY_ENV}"

# --- dotenv loader (prefer existing env; else source .env.dev) ---------------
_load_kms_env() {
  local need=0
  [[ -z "${KMS_PROJECT_ID:-}"  ]] && need=1
  [[ -z "${KMS_LOCATION_ID:-}" ]] && need=1
  [[ -z "${KMS_KEY_RING_ID:-}" ]] && need=1
  [[ -z "${KMS_KEY_ID:-}"      ]] && need=1

  if [[ $need -eq 1 ]]; then
    if [[ -f "$ENVFILE" ]]; then
      # Export assignments from .env (comments/blank lines ignored by bash)
      # shellcheck disable=SC1090
      set -a; . "$ENVFILE"; set +a
    fi
  fi

  : "${KMS_PROJECT_ID:?KMS_PROJECT_ID is required (env or $ENVFILE)}"
  : "${KMS_LOCATION_ID:?KMS_LOCATION_ID is required (env or $ENVFILE)}"
  : "${KMS_KEY_RING_ID:?KMS_KEY_RING_ID is required (env or $ENVFILE)}"
  : "${KMS_KEY_ID:?KMS_KEY_ID is required (env or $ENVFILE)}"
}

# --- auth: get an access token non-interactively -----------------------------
_get_access_token() {
  if command -v gcloud >/dev/null 2>&1; then
    if tok="$(gcloud auth application-default print-access-token 2>/dev/null)"; then
      printf '%s' "$tok"; return 0
    fi
    if tok="$(gcloud auth print-access-token 2>/dev/null)"; then
      printf '%s' "$tok"; return 0
    fi
  fi
  echo "ERROR: No GCP credentials found. Provide ADC or run 'gcloud auth login' locally." >&2
  return 1
}

# --- test body ---------------------------------------------------------------
t2_kms_connectivity() {
  _load_kms_env

  local key_path="projects/${KMS_PROJECT_ID}/locations/${KMS_LOCATION_ID}/keyRings/${KMS_KEY_RING_ID}/cryptoKeys/${KMS_KEY_ID}"
  local url="https://cloudkms.googleapis.com/v1/${key_path}"
  local token; token="$(_get_access_token)"

  echo "— Using env file: ${ENVFILE:-<none>}"
  echo "— KMS key path: ${key_path}"
  echo "— GET ${url}"

  local tmpout; tmpout="$(mktemp -t kms.XXXXXX)"
  trap 'rm -f "$tmpout"' EXIT

  local status
  status="$(curl -sS -o "$tmpout" -w '%{http_code}' \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: application/json" \
    "$url")"

  if command -v jq >/dev/null 2>&1; then jq . < "$tmpout" || cat "$tmpout"; else cat "$tmpout"; fi
  echo

  if [[ "$status" != "200" ]]; then
    echo "❌ KMS GET failed (HTTP $status)" >&2
    return 2
  fi

  local got
  if command -v jq >/dev/null 2>&1; then
    got="$(jq -r '.name // empty' < "$tmpout")"
  else
    got="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmpout" | head -n1)"
  fi

  if [[ -z "$got" ]]; then
    echo "❌ Response missing .name field" >&2
    return 3
  fi
  if [[ "$got" != "$key_path" ]]; then
    echo "❌ Key name mismatch
Expected: ${key_path}
Got:      ${got}" >&2
    return 4
  fi

  echo "✅ KMS reachable; key metadata OK."
  return 0
}

# --- register ----------------------------------------------------------------
register_test 2 "google kms connectivity (GET cryptoKey)" t2_kms_connectivity
