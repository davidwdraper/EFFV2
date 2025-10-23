#!/bin/bash
# clone_v2.sh — Recreate v2 clones of all .ts files under backend/services/svcfacilitator
# macOS Bash 3.2 compatible (no Bash 4 features)
# Behavior:
#   - Deletes any existing *.v2.ts files.
#   - Creates fresh clones of every *.ts file (except existing .v2.ts) as <name>.v2.ts in same folder.

set -e

BASE_DIR="backend/services/svcfacilitator"

echo "🧹 Cleaning and cloning .ts files under $BASE_DIR → *.v2.ts"
echo

# 1️⃣ Delete all existing .v2.ts files
find "$BASE_DIR" -type f -name "*.v2.ts" | while read -r OLDV2; do
  rm -f "$OLDV2"
  echo "🗑️  Deleted old clone: $OLDV2"
done

echo
echo "🔁 Creating fresh .v2.ts clones..."
echo

# 2️⃣ Clone all .ts files (except .v2.ts) to new .v2.ts
find "$BASE_DIR" -type f -name "*.ts" ! -name "*.v2.ts" | while read -r FILE; do
  DIR=$(dirname "$FILE")
  BASE=$(basename "$FILE" .ts)
  NEWFILE="$DIR/${BASE}.v2.ts"

  cp "$FILE" "$NEWFILE"
  echo "✅  Cloned: $FILE → $NEWFILE"
done

echo
echo "🎯 All .v2.ts clones recreated successfully."
