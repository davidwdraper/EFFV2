# backend/scripts/convert-controller-to-json.sh
#!/usr/bin/env bash
# =============================================================================
# NowVibin — Convert ControllerBase → ControllerJsonBase (JSON-only phase)
# macOS Bash 3.2 compatible
# =============================================================================

set -euo pipefail

ROOT="backend"

echo "──────────────────────────────────────────────"
echo " NowVibin: ControllerBase → ControllerJsonBase"
echo "──────────────────────────────────────────────"

# Find all TypeScript files under backend/
find "$ROOT" -type f -name "*.ts" | while IFS= read -r file; do
  # 1) Fix imports that reference ControllerBase
  #    e.g. import { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
  sed -i '' '/import/{
    /ControllerBase/s/ControllerBase/ControllerJsonBase/g
  }' "$file"

  # 2) Fix class inheritance
  #    e.g. export class FooController extends ControllerBase {
  sed -i '' '/extends/{
    /ControllerBase/s/ControllerBase/ControllerJsonBase/g
  }' "$file"
done

echo "Done. Review changes with: git diff"
echo "──────────────────────────────────────────────"
