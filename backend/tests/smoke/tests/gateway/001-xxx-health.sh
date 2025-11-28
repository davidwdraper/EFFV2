#!/usr/bin/env bash
# backend/tests/smoke/tests/001-xxx-health.sh
# 001 - health check
# Works with env: SLUG, HOST, PORT, VERSION, SVCFAC_BASE_URL, BASE
# Expected usage:
#   ./smoke.sh --slug xxx --port <port> 1
set -euo pipefail

# --- Require PORT from runner BEFORE lib.sh can default it --------------------
if [ -z "${PORT:-}" ]; then
  echo "ERROR: PORT is not set. Run this test via smoke.sh with --port <port>." >&2
  exit 2
fi

# --- Source shared smoke library (header/footer, helpers, etc.) --------------
# Path: tests/xxx/ -> ../../lib.sh
# shellcheck source=../../lib.sh
. "$(dirname "$0")/../../lib.sh"

# --- Config (env override friendly) ------------------------------------------
SLUG="${SLUG:-xxx}"
HOST="${HOST:-127.0.0.1}"
VERSION="${VERSION:-1}"

# Precedence: BASE (if provided) > SVCFAC_BASE_URL > computed from HOST/PORT
if [ -z "${BASE:-}" ]; then
  if [ -n "${SVCFAC_BASE_URL:-}" ]; then
    BASE="${SVCFAC_BASE_URL}/api/${SLUG}/v${VERSION}"
  else
    BASE="http://${HOST}:${PORT}/api/${SLUG}/v${VERSION}"
  fi
fi

URL="${BASE}/health"

# --- Request (log the exact curl) --------------------------------------------
echo "→ GET ${URL}" >&2
RESP="$(curl -sS -H 'Accept: application/json' "${URL}")"

# --- Must be JSON -------------------------------------------------------------
echo "${RESP}" | jq -e . >/dev/null

# --- Assert envelope: ok == true ---------------------------------------------
OK="$(echo "${RESP}" | jq -r 'select(.ok!=null) | .ok')"
[ "${OK}" = "true" ] || { echo "ERROR: ok != true"; echo "${RESP}" | jq .; exit 1; }

# --- If 'service' present, it must match SLUG --------------------------------
if echo "${RESP}" | jq -e 'has("service")' >/dev/null; then
  SVC="$(echo "${RESP}" | jq -r '.service')"
  [ "${SVC}" = "${SLUG}" ] || { echo "ERROR: service != ${SLUG}"; echo "${RESP}" | jq .; exit 1; }
fi