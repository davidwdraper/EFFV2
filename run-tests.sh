# /eff/run-tests.sh
#!/usr/bin/env bash
set -Eeuo pipefail

# NowVibin test runner (repo root) — POSIX friendly
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export NODE_ENV="test"
export ENV_FILE="${ENV_FILE:-.env.test}"
export REDIS_DISABLED="${REDIS_DISABLED:-1}"
export CI="${CI:-0}"

bold()  { printf "\033[1m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
rule()  { printf "\n\033[90m%s\033[0m\n" "────────────────────────────────────────────────────────────────────────────────"; }

trap 'red "✗ Test run failed"; exit 1' ERR

bold "NowVibin — Test Runner"
echo "ROOT: ${ROOT}"
echo "ENV_FILE: ${ENV_FILE}"
echo "NODE_ENV: ${NODE_ENV}"
echo "REDIS_DISABLED: ${REDIS_DISABLED}"
rule

services=( "act" )

for svc in "${services[@]}"; do
  pkg="${svc}-service"
  svc_dir="${ROOT}/backend/services/${svc}"
  cfg_abs="${svc_dir}/vitest.config.ts"
  covdir_rel="backend/services/${svc}/coverage"
  covdir_abs="${ROOT}/${covdir_rel}"

  svc_upper="$(printf '%s' "$svc" | tr '[:lower:]' '[:upper:]')"
  bold "→ ${svc_upper} service"
  echo "workspace: ${pkg}"
  echo "root:      ${svc_dir}"
  echo "config:    ${cfg_abs}"
  echo "coverage:  ${covdir_rel}"

  [[ -f "$cfg_abs" ]] || { red "Missing Vitest config: $cfg_abs"; exit 1; }

  rm -rf "$covdir_abs"

  # IMPORTANT: pass --root so Vitest discovers test files under the service dir
  yarn --silent workspace "${pkg}" vitest run \
    --root "${svc_dir}" \
    -c "${cfg_abs}" \
    --coverage \
    --reporter=dot

  rule
  [[ -d "$covdir_abs" ]] && green "✓ Coverage artifacts written to ${covdir_rel}" || red "⚠ No coverage artifacts found for ${svc}"
done

green "✓ All requested test suites completed successfully."
