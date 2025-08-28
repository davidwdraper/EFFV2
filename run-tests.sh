# /eff/run-tests.sh
#!/usr/bin/env bash
set -Eeuo pipefail

# NowVibin test runner (repo root) — POSIX-friendly
# Supports:
#   --allowlist [FILE]  Run ONLY tests listed in ALLOWLIST (one relative path per line)
#                       If FILE omitted, defaults to backend/services/<svc>/test/ALLOWLIST.txt
#   --svc <name>        Limit to a single service (default: act)
#   -h|--help           Show usage
#
# Behavior:
#   • Allowlist mode: FAST, no coverage, runs only approved tests.
#   • Full mode (default): runs entire suite with coverage (original behavior).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export NODE_ENV="test"
export ENV_FILE="${ENV_FILE:-.env.test}"
export REDIS_DISABLED="${REDIS_DISABLED:-1}"
export CI="${CI:-0}"
export GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://localhost:4000}"

bold()  { printf "\033[1m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
rule()  { printf "\n\033[90m%s\033[0m\n" "────────────────────────────────────────────────────────────────────────────────"; }

usage() {
  cat <<'USAGE'
Usage: run-tests.sh [--allowlist [FILE]] [--svc <name>] [-h|--help]

Options:
  --allowlist [FILE]  Run only tests listed in ALLOWLIST (one per line, relative to service root).
                      If FILE omitted, defaults to backend/services/<svc>/test/ALLOWLIST.txt
  --svc <name>        Limit to a single service (default: act)
  -h, --help          Show this help

Environment:
  ENV_FILE            .env file to load (default: .env.test)
  GATEWAY_BASE_URL    Base URL for gateway tests (default: http://localhost:4000)
  REDIS_DISABLED      Set to 1 to disable Redis during tests (default: 1)
USAGE
}

trap 'red "✗ Test run failed"; exit 1' ERR

# ───────────────────────────────────────────────────────────────────────────────
# Parse flags safely under `set -u` (POSIX-safe; no mapfile/process substitution)
# ───────────────────────────────────────────────────────────────────────────────
allowlist_flag=""
allowlist_file=""
svc_arg=""

while [ "$#" -gt 0 ]; do
  case "${1:-}" in
    --allowlist)
      allowlist_flag="1"
      shift || true
      # Optional file path after --allowlist
      if [ "$#" -gt 0 ] && [ "${1#--}" = "${1}" ]; then
        allowlist_file="${1:-}"
        shift || true
      fi
      ;;
    --svc)
      shift || true
      svc_arg="${1:-}"
      if [ -z "${svc_arg:-}" ] || [ "${svc_arg#--}" != "${svc_arg}" ]; then
        red "Missing value for --svc"; usage; exit 2
      fi
      shift || true
      ;;
    -h|--help)
      usage; exit 0
      ;;
    --*)
      red "Unknown flag: ${1:-}"; usage; exit 2
      ;;
    *)
      red "Unexpected argument: ${1:-}"; usage; exit 2
      ;;
  esac
done

bold "NowVibin — Test Runner"
echo "ROOT: ${ROOT}"
echo "ENV_FILE: ${ENV_FILE}"
echo "NODE_ENV: ${NODE_ENV}"
echo "REDIS_DISABLED: ${REDIS_DISABLED}"
echo "GATEWAY_BASE_URL: ${GATEWAY_BASE_URL}"
rule

# Default service set; expand as new services come online
services="act"
[ -n "${svc_arg:-}" ] && services="${svc_arg}"

for svc in $services; do
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

  [ -f "$cfg_abs" ] || { red "Missing Vitest config: $cfg_abs"; exit 1; }

  if [ -n "${allowlist_flag:-}" ]; then
    # Focused allowlist run (no coverage)
    list_abs="${allowlist_file:-}"
    if [ -z "${list_abs:-}" ]; then
      list_abs="${svc_dir}/test/ALLOWLIST.txt"
      yellow "No allowlist file provided; defaulting to: ${list_abs}"
    fi
    [ -f "$list_abs" ] || { red "Allowlist not found: $list_abs"; exit 1; }

    # Read non-empty, non-comment lines into an array (POSIX-safe)
    files_count=0
    # shellcheck disable=SC2034
    files_list=""
    # Build a space-delimited list carefully (supports spaces via quoting later)
    # Note: Vitest paths should avoid spaces; still, we quote when invoking.
    while IFS= read -r line || [ -n "$line" ]; do
      # Trim leading/trailing whitespace
      trimmed="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      # Skip empty or comment lines
      case "$trimmed" in
        ""|\#*) continue ;;
      esac
      if [ -z "${files_list:-}" ]; then
        files_list="$trimmed"
      else
        files_list="$files_list
$trimmed"
      fi
      files_count=$((files_count + 1))
    done < "$list_abs"

    if [ "$files_count" -le 0 ]; then
      red "Allowlist is empty: $list_abs"; exit 1
    fi

    echo "Allowlist (${files_count} files): $list_abs"
    printf '%s\n' "$files_list" | while IFS= read -r f; do printf "  - %s\n" "$f"; done

    # Build argv without arrays (POSIX); rely on newline separation
    base_args="--root \"$svc_dir\" -c \"$cfg_abs\" --reporter=dot"
    file_args=""
    while IFS= read -r f; do
      # Quote each file argument
      if [ -z "${file_args:-}" ]; then
        file_args="\"$f\""
      else
        file_args="$file_args \"$f\""
      fi
    done <<EOF
$files_list
EOF

    # Execute vitest with eval to preserve quoting
    # shellcheck disable=SC2086
    eval yarn --silent workspace "\"${pkg}\"" vitest run $base_args $file_args

  else
    # Full suite with coverage (original behavior)
    rm -rf "$covdir_abs"
    yarn --silent workspace "${pkg}" vitest run \
      --root "${svc_dir}" \
      -c "${cfg_abs}" \
      --coverage \
      --reporter=dot

    rule
    if [ -d "$covdir_abs" ]; then
      green "✓ Coverage artifacts written to ${covdir_rel}"
    else
      red "⚠ No coverage artifacts found for ${svc}"
    fi
  fi

  rule
done

green "✓ Test suites completed."
