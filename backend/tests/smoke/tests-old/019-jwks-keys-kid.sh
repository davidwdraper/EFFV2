# backend/tests/smoke/tests/019-jwks-keys-kid.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke: JWKS /keys via Gateway (shape + deterministic kid)
# Proxies through gateway → jwks@1
# Will source JWKS_ENV_FILE if provided to get KMS_* vars.
# If KMS_* present → strict kid equality; else → regex shape check.
# macOS bash 3.2 compatible
# ============================================================================
set -euo pipefail

URL="${URL:-http://127.0.0.1:4000/api/jwks/v1/keys}"

# Optionally source an env file to populate KMS_* vars for strict checks
if [ -n "${JWKS_ENV_FILE:-}" ] && [ -f "${JWKS_ENV_FILE}" ]; then
  echo "… sourcing JWKS_ENV_FILE=${JWKS_ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  . "${JWKS_ENV_FILE}"
  set +a
fi

echo "→ GET ${URL}"
RESP="$(curl -sS -H 'Accept: application/json' "$URL" || true)"

if [ -z "${RESP}" ]; then
  echo "ERROR: Empty response from $URL"
  exit 1
fi

# Must be a raw JWKS object (no NV envelope): { "keys": [...] }
if ! echo "$RESP" | jq -e '.keys and (.keys|type == "array") and (.keys|length>=1)' >/dev/null 2>&1; then
  echo "ERROR: Response is not a JWKS Set (missing .keys[]):"
  echo "$RESP"
  exit 1
fi

KTY="$(echo "$RESP" | jq -r '.keys[0].kty')"
KID="$(echo "$RESP" | jq -r '.keys[0].kid')"
ALG="$(echo "$RESP" | jq -r '.keys[0].alg // empty')"

if [ -z "$KID" ]; then
  echo "ERROR: kid missing in first key:"
  echo "$RESP" | jq .
  exit 1
fi

STRICT_CHECK=true
for v in KMS_PROJECT_ID KMS_LOCATION_ID KMS_KEY_RING_ID KMS_KEY_ID KMS_KEY_VERSION KMS_JWT_ALG; do
  if [ -z "${!v:-}" ]; then STRICT_CHECK=false; fi
done

if $STRICT_CHECK; then
  EXPECT_KID="${KMS_PROJECT_ID}:${KMS_LOCATION_ID}:${KMS_KEY_RING_ID}:${KMS_KEY_ID}:${KMS_KEY_VERSION}"
  if [ "$KID" != "$EXPECT_KID" ]; then
    echo "ERROR: kid mismatch."
    echo "  expected: $EXPECT_KID"
    echo "  actual:   $KID"
    echo "$RESP" | jq .
    exit 1
  fi
  if [ -n "$ALG" ] && [ "$ALG" != "$KMS_JWT_ALG" ]; then
    echo "ERROR: alg mismatch."
    echo "  expected: $KMS_JWT_ALG"
    echo "  actual:   $ALG"
    echo "$RESP" | jq .
    exit 1
  fi
else
  # Fallback: check kid shape (provider:5-segment form), and basic kty shape.
  if ! echo "$KID" | grep -Eq '^[^:]+:[^:]+:[^:]+:[^:]+:[^:]+$'; then
    echo "ERROR: kid does not look like <project>:<location>:<ring>:<key>:<version>: $KID"
    echo "$RESP" | jq .
    exit 1
  fi
fi

# Minimal per-kty shape checks
case "$KTY" in
  RSA)
    if ! echo "$RESP" | jq -e '.keys[0].n and .keys[0].e' >/dev/null 2>&1; then
      echo "ERROR: RSA JWK missing n/e:"
      echo "$RESP" | jq .
      exit 1
    fi
    ;;
  EC)
    if ! echo "$RESP" | jq -e '.keys[0].crv and .keys[0].x and .keys[0].y' >/dev/null 2>&1; then
      echo "ERROR: EC JWK missing crv/x/y:"
      echo "$RESP" | jq .
      exit 1
    fi
    ;;
  *)
    echo "ERROR: Unsupported kty: $KTY"
    echo "$RESP" | jq .
    exit 1
    ;;
esac

echo "OK: /keys returns valid JWKS (kid=${KID})"
