# tools/dev/find-console-logs.sh
#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-backend}"

# ripgrep required: brew install ripgrep  (mac) / apt-get install ripgrep (debian)
if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep (rg) is required." >&2
  exit 2
fi

echo "🔎 scanning for console.{log,info,warn,error,debug} under: $ROOT"
echo

rg -n --hidden --no-ignore -S \
  -g '!**/node_modules/**' \
  -g '!**/dist/**' \
  -g '!**/build/**' \
  -g '!**/.next/**' \
  -g '!**/*.map' \
  -g '!backend/shared/src/util/logger.ts' \
  -e 'console\.(log|info|warn|error|debug)\s*\(' \
  "$ROOT" \
| sed -E 's/^/(match) /'

echo
echo "💡 next steps:"
echo "  1) Replace matches with our shared logger:"
echo "       import { log } from \"@nv/shared/util/logger\""
echo "  2) Prefer bound context (service-level or request-level):"
echo "       const l = log.bind({ slug: process.env.SVC_NAME || \"-\", version: 1, url: \"<path|url>\" })"
echo "       l.info(\"message\")"
echo "  3) For background jobs, bind a stable context once at module init."
