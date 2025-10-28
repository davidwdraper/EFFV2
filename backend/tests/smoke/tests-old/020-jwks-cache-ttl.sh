# backend/tests/smoke/tests/020-jwks-cache-ttl.sh
#!/usr/bin/env bash
# ============================================================================
# Smoke: JWKS TTL cache behavior
# - Auto-sources backend/services/jwks/.env.dev to read NV_JWKS_CACHE_TTL_MS
# - First call warms the cache
# - Second call (within TTL/2) should be identical (or at least valid)
# - Third call (after TTL+buffer) should also be valid (refresh may or may not
#   change payload; we only assert no errors and JWKS shape)
# Requires: gateway :4000 proxying jwks@1
# Path: /api/jwks/v1/keys (proxied)
# macOS bash 3.2 compatible — no Python required
# ============================================================================
set -euo pipefail

URL="${URL:-http://127.0.0.1:4000/api/jwks/v1/keys}"

# Resolve repo root relative to this script and source .env.dev automatically
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# This script lives at backend/tests/smoke/tests; repo root is three levels up
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
JWKS_ENV_FILE="${REPO_ROOT}/services/jwks/.env.dev"
# Back-compat if your layout is backend/services/...
if [ ! -f "${JWKS_ENV_FILE}" ]; then
  JWKS_ENV_FILE="${REPO_ROOT}/backend/services/jwks/.env.dev"
fi

if [ -f "${JWKS_ENV_FILE}" ]; then
  echo "… sourcing ${JWKS_ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  . "${JWKS_ENV_FILE}"
  set +a
else
  echo "ERROR: .env.dev not found at expected locations."
  echo "Looked for:"
  echo "  - ${REPO_ROOT}/services/jwks/.env.dev"
  echo "  - ${REPO_ROOT}/backend/services/jwks/.env.dev"
  exit 1
fi

# Require TTL from env file (no hidden defaults)
: "${NV_JWKS_CACHE_TTL_MS:?NV_JWKS_CACHE_TTL_MS required in jwks .env.dev}"

HALF_TTL_MS=$(( NV_JWKS_CACHE_TTL_MS / 2 ))
AFTER_TTL_MS=$(( NV_JWKS_CACHE_TTL_MS + 250 ))

# Helper: sleep milliseconds using awk to produce fractional seconds for BSD sleep
sleep_ms () {
  ms="$1"
  # prints e.g., 0.500 for 500ms; BSD sleep accepts fractional seconds
  secs="$(awk "BEGIN { printf(\"%.3f\", ${ms}/1000) }")"
  sleep "${secs}"
}

echo "→ Warm 1: GET ${URL}"
R1="$(curl -sS -H 'Accept: application/json' "$URL")"
if ! echo "$R1" | jq -e '.keys and (.keys|length>=1)' >/dev/null 2>&1; then
  echo "ERROR: First response is not a JWKS Set:"
  echo "$R1"
  exit 1
fi

echo "… sleeping ${HALF_TTL_MS}ms (within TTL)"
sleep_ms "${HALF_TTL_MS}"

echo "→ Hit 2 (within TTL): GET ${URL}"
R2="$(curl -sS -H 'Accept: application/json' "$URL")"
if ! echo "$R2" | jq -e '.keys and (.keys|length>=1)' >/dev/null 2>&1; then
  echo "ERROR: Second response invalid:"
  echo "$R2"
  exit 1
fi

# NOTE: We don't hard-fail on content diffs since server-side ordering can vary.
if [ "$R1" != "$R2" ]; then
  echo "INFO: Responses differ within TTL (may be benign; showing diff):"
  diff -u <(echo "$R1" | jq .) <(echo "$R2" | jq .) || true
fi

echo "… sleeping ${AFTER_TTL_MS}ms (past TTL)"
sleep_ms "${AFTER_TTL_MS}"

echo "→ Hit 3 (post TTL): GET ${URL}"
R3="$(curl -sS -H 'Accept: application/json' "$URL")"
if ! echo "$R3" | jq -e '.keys and (.keys|length>=1)' >/dev/null 2>&1; then
  echo "ERROR: Third response invalid:"
  echo "$R3"
  exit 1
fi

echo "OK: TTL behavior exercised (warm → within TTL → after TTL) with no errors"
