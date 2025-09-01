# scripts/build-shared.sh
#!/usr/bin/env bash
# scripts/build-shared.sh
set -Eeuo pipefail

# Usage:
#   ./scripts/build-shared.sh           # clean + build once
#   ./scripts/build-shared.sh watch     # watch mode

MODE="${1:-build}"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SHARED_DIR="$ROOT/backend/services/shared"

echo "▶ Building @shared at: $SHARED_DIR"

if [[ ! -d "$SHARED_DIR" ]]; then
  echo "❌ Shared package not found at $SHARED_DIR"
  exit 1
fi

cd "$SHARED_DIR"

if [[ ! -f "tsconfig.json" ]]; then
  echo "❌ tsconfig.json missing in $SHARED_DIR"
  exit 1
fi

if [[ "$MODE" == "watch" ]]; then
  echo "👀 Watch mode"
  yarn tsc --build --watch
  exit 0
fi

# Clean + build
yarn tsc --build --clean
yarn tsc --build

# Derive outDir for a friendly success message
OUTDIR="$(node -e 'try{console.log(require("./tsconfig.json").compilerOptions.outDir||"dist")}catch{process.exit(1)}' 2>/dev/null || echo "dist")"

if [[ ! -d "$OUTDIR" ]]; then
  echo "❌ Build finished but output dir not found: $SHARED_DIR/$OUTDIR"
  exit 1
fi

echo "✅ @shared built → $SHARED_DIR/$OUTDIR"
