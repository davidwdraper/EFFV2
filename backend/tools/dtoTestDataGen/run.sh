# backend/tools/dtoTestDataGen/run.sh
#!/usr/bin/env bash
# =============================================================================
# NV Tool Runner: dtoTestDataGen
# macOS Bash 3.2 compatible
# =============================================================================
set -Eeuo pipefail

TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "dtoTestDataGen/run.sh: node is required but was not found on PATH." 1>&2
  exit 2
fi

# We intentionally do NOT assume NV has a script runner yet.
# This runner fail-fast requires `tsx` (recommended) and uses `npx`.
if ! command -v npx >/dev/null 2>&1; then
  echo "dtoTestDataGen/run.sh: npx is required (ships with npm). Install Node/npm properly." 1>&2
  exit 2
fi

# Fail-fast if tsx is not available (no silent fallbacks).
if ! npx --yes --quiet tsx -v >/dev/null 2>&1; then
  echo "dtoTestDataGen/run.sh: missing dev tool: tsx" 1>&2
  echo "Install (devDependency): npm i -D tsx" 1>&2
  exit 2
fi

CMD="${1:-}"
shift || true

case "$CMD" in
  scan)
    exec npx --yes tsx "$TOOL_DIR/nv-dto-scan.ts" "$@"
    ;;
  gen)
    exec npx --yes tsx "$TOOL_DIR/nv-dto-gen.ts" "$@"
    ;;
  ""|-h|--help|help)
    echo "Usage:" 1>&2
    echo "  ./run.sh scan [--root <path>]" 1>&2
    echo "  ./run.sh gen --dto <path-to-*.dto.ts> [--write] [--force] [--no-verify] [--print] [--skip-no-fields]" 1>&2
    echo "" 1>&2
    echo "Examples:" 1>&2
    echo "  ./run.sh scan" 1>&2
    echo "  ./run.sh gen --dto backend/services/shared/src/dto/user.dto.ts --write" 1>&2
    echo "  ./run.sh scan | xargs -n 1 ./run.sh gen --write --skip-no-fields" 1>&2
    ;;
  *)
    echo "dtoTestDataGen/run.sh: unknown command: $CMD" 1>&2
    echo "Try: ./run.sh help" 1>&2
    exit 2
    ;;
esac
