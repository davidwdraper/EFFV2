# /eff/scripts/test/run-one.sh
#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export NODE_ENV="test"
export ENV_FILE="${ENV_FILE:-.env.test}"
export REDIS_DISABLED="${REDIS_DISABLED:-1}"
export GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://localhost:4000}"

svc="${1:-act}"
file_rel="${2:-}"
name_pat="${3:-}"

[[ -n "$file_rel" ]] || { echo "Usage: $0 <svc> <relative-test-file> [name-pattern]"; exit 2; }

svc_dir="${ROOT}/backend/services/${svc}"
cfg_abs="${svc_dir}/vitest.config.ts"
[[ -f "$cfg_abs" ]] || { echo "Missing: $cfg_abs"; exit 1; }

# Run a single file; optional test name filter
cmd=( yarn --silent workspace "${svc}-service" vitest run --root "$svc_dir" -c "$cfg_abs" --reporter=dot "$file_rel" )
[[ -n "$name_pat" ]] && cmd+=( -t "$name_pat" )

echo "NODE_ENV=$NODE_ENV ENV_FILE=$ENV_FILE SVC=$svc FILE=$file_rel NAME=$name_pat"
echo "GATEWAY_BASE_URL=$GATEWAY_BASE_URL"
"${cmd[@]}"
