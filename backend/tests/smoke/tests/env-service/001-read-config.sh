#!/usr/bin/env bash
# backend/tests/smoke/tests/env-service/001-read-config.sh
# Purpose:
# - Read a single EnvServiceDto config record via the public config endpoint.
# - Assert:
#   - HTTP 200
#   - Exactly one item in the DtoBag
#   - slug/env/version match expectations
#   - vars contains NV_MONGO_URI and NV_MONGO_DB (non-empty)
#   - No DB shape leak (_id) in the returned item.
#
# Assumptions:
# - env-service is running and has a config row matching:
#     env     = NV_ENV (if set) else "dev"
#     slug    = CONFIG_SLUG (if set) else SLUG (from smoke.sh) else "env-service"
#     version = CONFIG_VERSION (if set) else 1
#
# Typical usage (from backend/tests/smoke):
#   ./smoke.sh --slug env-service --all
#   ./smoke.sh --slug env-service 1

set -euo pipefail

# Resolve repo root and load shared smoke lib
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../../../../" && pwd))"
SMOKE_DIR="$ROOT/backend/tests/smoke"
# shellcheck disable=SC1090
. "$SMOKE_DIR/lib.sh"

# ------------------------- config for this test -------------------------------

SLUG="${SLUG:-env-service}"
DTO_TYPE="${DTO_TYPE:-env-service}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-4015}"

TARGET_ENV="${NV_ENV:-dev}"
TARGET_SLUG="${CONFIG_SLUG:-$SLUG}"
TARGET_VERSION="${CONFIG_VERSION:-1}"

# /api/<slug>/v1/<dtoType>
BASE="$(svc_base_for_type)"  # e.g. http://127.0.0.1:4015/api/env-service/v1/env-service
CONFIG_URL="${BASE}/config?slug=${TARGET_SLUG}&version=${TARGET_VERSION}&env=${TARGET_ENV}"

# ------------------------------- run request ----------------------------------
# IMPORTANT: don't use command substitution with _get_json, or LAST_HTTP_CODE
# will be set in a subshell and lost. Run it directly and capture stdout.

TMP_BODY="$(mktemp -t nv_env_config_body.XXXXXX)"
_get_json "$CONFIG_URL" >"$TMP_BODY"
BODY="$(cat "$TMP_BODY")"
rm -f "$TMP_BODY"

if [ "${LAST_HTTP_CODE:-0}" -ne 200 ]; then
  failf "expected HTTP 200 but got %s (URL=%s)" "${LAST_HTTP_CODE:-0}" "$CONFIG_URL"
fi

# For debugging on failures, always dump the body once.
echo "$BODY" | jq . >&2 || true

# ------------------------------- assertions -----------------------------------

# 1) Exactly one item in the bag
ITEM_COUNT="$(echo "$BODY" | jq -r '.items | length')"
if [ "$ITEM_COUNT" != "1" ]; then
  failf "expected exactly 1 config item, got %s" "$ITEM_COUNT"
fi

# 2) Core identity fields (no more level)
RESP_SLUG="$(echo "$BODY"    | jq -r '.items[0].slug // empty')"
RESP_ENV="$(echo "$BODY"     | jq -r '.items[0].env // empty')"
RESP_VERSION="$(echo "$BODY" | jq -r '.items[0].version // empty')"

[ -n "$RESP_SLUG" ]    || fail "config item missing slug"
[ -n "$RESP_ENV" ]     || fail "config item missing env"
[ -n "$RESP_VERSION" ] || fail "config item missing version"

[ "$RESP_SLUG"    = "$TARGET_SLUG" ]    || failf "slug mismatch: resp=%s expected=%s"    "$RESP_SLUG"    "$TARGET_SLUG"
[ "$RESP_ENV"     = "$TARGET_ENV" ]     || failf "env mismatch: resp=%s expected=%s"     "$RESP_ENV"     "$TARGET_ENV"
[ "$RESP_VERSION" = "$TARGET_VERSION" ] || failf "version mismatch: resp=%s expected=%s" "$RESP_VERSION" "$TARGET_VERSION"

# 3) vars contains Mongo config keys
MONGO_URI="$(echo "$BODY" | jq -r '.items[0].vars.NV_MONGO_URI // empty')"
MONGO_DB="$(echo "$BODY"  | jq -r '.items[0].vars.NV_MONGO_DB  // empty')"

[ -n "$MONGO_URI" ] && [ "$MONGO_URI" != "null" ] \
  || fail "vars.NV_MONGO_URI missing or empty — env-service config cannot boot Mongo readers; check bootstrap seed."

[ -n "$MONGO_DB" ] && [ "$MONGO_DB" != "null" ] \
  || fail "vars.NV_MONGO_DB missing or empty — env-service config missing DB name; check bootstrap seed."

# 4) No DB shape leaks
HAS_DB_ID="$(echo "$BODY" | jq -r '.items[0] | has("_id")')"
if [ "$HAS_DB_ID" = "true" ]; then
  fail "response leaks DB shape: items[0]._id present; DTO-only contract forbids this."
fi

passf "config read OK (slug=%s env=%s version=%s)" \
  "$RESP_SLUG" "$RESP_ENV" "$RESP_VERSION"
