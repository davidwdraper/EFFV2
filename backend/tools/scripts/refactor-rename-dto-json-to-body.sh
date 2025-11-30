# scripts/refactor-rename-dto-json-to-body.sh
#!/usr/bin/env bash
# =============================================================================
# NV Refactor Script — Rename DTO IO Methods
# macOS Bash 3.2 compatible
#
# Purpose:
# - Repo-wide, case-sensitive replacement:
#     toJson   → toBody
#     fromJson → fromBody
# - Limited to backend .ts and .js files.
#
# Notes:
# - Uses word-boundary replacements so `toJson` inside longer identifiers
#   (e.g., toJsonString) will NOT be changed.
# - Assumes perl is available (default on macOS).
#
# Usage (from repo root):
#   chmod +x scripts/refactor-rename-dto-json-to-body.sh
#   ./scripts/refactor-rename-dto-json-to-body.sh
#
# Strongly recommended:
#   - Commit or stash before running.
#   - Run tests/smokes immediately afterwards.
# =============================================================================

set -Eeuo pipefail

ROOT_DIR="$(pwd)"

echo "NV DTO rename refactor starting..."
echo "Root: ${ROOT_DIR}"
echo "Target: backend/**/*.ts, backend/**/*.js"
echo

# Safety: ensure we're in a repo that has backend/services/shared
if [ ! -d "backend/services/shared" ]; then
  echo "❌ This script expects to be run from the NV repo root (backend/services/shared missing)."
  exit 1
fi

# Quick precheck: show how many files contain toJson/fromJson before changes
echo "Pre-check: files containing 'toJson' or 'fromJson' under backend/:"
grep -R --include='*.ts' --include='*.js' -n 'toJson' backend || true
grep -R --include='*.ts' --include='*.js' -n 'fromJson' backend || true
echo "---------------------------------------------------------------------"
echo "About to apply in-place replacements:"
echo "  - toJson   → toBody"
echo "  - fromJson → fromBody"
echo

# You can uncomment this block if you want an interactive confirmation.
# echo "Press ENTER to continue, or Ctrl+C to abort."
# read _

# Run the replacements.
# - \btoJson\b ensures we only touch the exact identifier, not substrings.
# - Same for fromJson.
find backend \
  -type f \
  \( -name "*.ts" -o -name "*.js" \) \
  -print0 | xargs -0 perl -pi -e 's/\btoJson\b/toBody/g; s/\bfromJson\b/fromBody/g;'

echo
echo "Refactor complete."
echo "Post-check: searching for any remaining toJson/fromJson..."
grep -R --include='*.ts' --include='*.js' -n 'toJson' backend || true
grep -R --include='*.ts' --include='*.js' -n 'fromJson' backend || true

echo
echo "Done. Review the diff (git diff) and run your test/smoke suite."
