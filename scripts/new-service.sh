#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   scripts/new-service.sh geo
#   scripts/new-service.sh geo --no-db

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <service-name> [--no-db]"
  exit 1
fi

SVC_RAW="$1"
NO_DB="${2:-}"
NO_DB_FLAG="false"
[[ "$NO_DB" == "--no-db" ]] && NO_DB_FLAG="true"

SVC_LOWER="$(echo "$SVC_RAW" | tr '[:upper:]' '[:lower:]')"
SVC_UPPER="$(echo "$SVC_RAW" | tr '[:lower:]' '[:upper:]')"
SVC_PASCAL="$(echo "${SVC_LOWER:0:1}" | tr '[:lower:]' '[:upper:]')${SVC_LOWER:1}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_DIR="$REPO_ROOT/backend/services/template"
DEST_DIR="$REPO_ROOT/backend/services/$SVC_LOWER"
SHARED_CONTRACT_DIR="$REPO_ROOT/backend/services/shared/contracts"
SHARED_CONTRACT="$SHARED_CONTRACT_DIR/${SVC_LOWER}.contract.ts"

# Detect sed -i variant (macOS vs GNU)
if sed --version >/dev/null 2>&1; then SED_I=(-i); else SED_I=(-i ''); fi

[[ -d "$TEMPLATE_DIR" ]] || { echo "ERROR: $TEMPLATE_DIR not found"; exit 1; }
[[ -e "$DEST_DIR" ]] && { echo "ERROR: $DEST_DIR already exists"; exit 1; }

echo "→ Creating $DEST_DIR from template"
cp -R "$TEMPLATE_DIR" "$DEST_DIR"

# Create shared contract stub EARLY to avoid later hangs/order issues
if [[ ! -f "$SHARED_CONTRACT" ]]; then
  echo "→ Creating shared contract stub: $SHARED_CONTRACT"
  mkdir -p "$SHARED_CONTRACT_DIR"
  cat > "$SHARED_CONTRACT" <<EOF
// backend/services/shared/contracts/${SVC_LOWER}.contract.ts
import { z } from "zod";

/** Canonical contract for ${SVC_PASCAL} (replace with real schema) */
export const ${SVC_LOWER}Contract = z.object({
  _id: z.string(),
  dateCreated: z.string(),
  dateLastUpdated: z.string(),
  name: z.string().min(1),
});

export type ${SVC_PASCAL} = z.infer<typeof ${SVC_LOWER}Contract>;
EOF
fi

# Rename ONLY the known entity directory to avoid nesting surprises
if [[ -d "$DEST_DIR/src/controllers/entity" ]]; then
  echo "→ Renaming controllers/entity → controllers/${SVC_LOWER}"
  mv "$DEST_DIR/src/controllers/entity" "$DEST_DIR/src/controllers/${SVC_LOWER}"
fi

# Rename filenames containing 'entity' → '<svc>'
echo "→ Renaming filenames containing 'entity'"
while IFS= read -r -d '' f; do
  newf="${f//entity/$SVC_LOWER}"
  [[ "$f" == "$newf" ]] || mv "$f" "$newf"
done < <(find "$DEST_DIR" -type f -name '*entity*' -print0)

# Content replacements across the service (no git dependency)
echo "→ Rewriting identifiers/imports in files"
find "$DEST_DIR" -type f \( -name "*.ts" -o -name "package.json" -o -name "*.md" \) -print0 \
| xargs -0 perl -0777 -pe "s/\\bEntity\\b/$SVC_PASCAL/g" -i
find "$DEST_DIR" -type f \( -name "*.ts" -o -name "package.json" -o -name "*.md" \) -print0 \
| xargs -0 perl -0777 -pe "s/\\bentity\\b/$SVC_LOWER/g" -i
find "$DEST_DIR" -type f \( -name "*.ts" -o -name "package.json" -o -name "*.md" \) -print0 \
| xargs -0 perl -0777 -pe "s/TEMPLATE_/${SVC_UPPER}_/g" -i
find "$DEST_DIR" -type f -name "*.ts" -print0 \
| xargs -0 perl -0777 -pe "s/SERVICE_NAME\\s*=\\s*\"template\"/SERVICE_NAME = \"${SVC_LOWER}\"/g" -i
find "$DEST_DIR" -type f -name "*.ts" -print0 \
| xargs -0 perl -0777 -pe "s/@shared\\/contracts\\/entity\\.contract/@shared\\/contracts\\/${SVC_LOWER}\\.contract/g" -i

# Route filename swap (if present)
if [[ -f "$DEST_DIR/src/routes/entity.routes.ts" ]]; then
  mv "$DEST_DIR/src/routes/entity.routes.ts" "$DEST_DIR/src/routes/${SVC_LOWER}.routes.ts"
fi

# Update imports in app.ts (route mount + import)
APP_TS="$DEST_DIR/src/app.ts"
if [[ -f "$APP_TS" ]];_]()]()
