#!/bin/bash
# fix-tsconfig.sh
# Standardize all service tsconfig.json files to use ./dist and ./src

set -euo pipefail

ROOT="backend/services"

for svc in "$ROOT"/*; do
  if [ -d "$svc" ] && [ -f "$svc/tsconfig.json" ]; then
    echo "🔧 Fixing $svc/tsconfig.json"

    # Backup original
    cp "$svc/tsconfig.json" "$svc/tsconfig.json.bak"

    # Write new tsconfig.json
    cat > "$svc/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"]
}
EOF
  fi
done

echo "✅ All service tsconfig.json files standardized (originals saved as *.bak)."
