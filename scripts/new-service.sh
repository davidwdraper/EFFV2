# scripts/new-service.sh
#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   scripts/new-service.sh geo
#   scripts/new-service.sh geo --no-db      # remove db/model files
#
# Expects:
#   backend/services/template/    ← green template service
# Creates:
#   backend/services/<svc>/
#   backend/services/shared/contracts/<svc>.contract.ts (if missing)
#
# Naming:
#   service name: geo
#   ENV prefix : GEO_
#   PascalCase : Geo
# ─────────────────────────────────────────────────────────────────────────────

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <service-name> [--no-db]"
  exit 1
fi

SVC_RAW="$1"
NO_DB="false"
if [[ "${2:-}" == "--no-db" ]]; then
  NO_DB="true"
fi

# Normalize names
SVC_LOWER="$(echo "$SVC_RAW" | tr '[:upper:]' '[:lower:]')"
SVC_UPPER="$(echo "$SVC_RAW" | tr '[:lower:]' '[:upper:]')"
# PascalCase (first letter upper, rest lower) — good enough for your conventions
SVC_PASCAL="$(echo "${SVC_LOWER:0:1}" | tr '[:lower:]' '[:upper:]')${SVC_LOWER:1}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_DIR="$REPO_ROOT/backend/services/template"
DEST_DIR="$REPO_ROOT/backend/services/$SVC_LOWER"
SHARED_CONTRACT="$REPO_ROOT/backend/services/shared/contracts/${SVC_LOWER}.contract.ts"

if [[ ! -d "$TEMPLATE_DIR" ]]; then
  echo "ERROR: Template not found at $TEMPLATE_DIR"
  exit 1
fi

if [[ -e "$DEST_DIR" ]]; then
  echo "ERROR: Destination already exists: $DEST_DIR"
  exit 1
fi

# Detect sed inline flag (macOS vs GNU)
if sed --version >/dev/null 2>&1; then
  SED_I=(-i)
else
  SED_I=(-i '')
fi

echo "Creating service '$SVC_LOWER' from template…"
cp -R "$TEMPLATE_DIR" "$DEST_DIR"

# 1) Rename directories containing 'entity' → '<svc>'
#    Do deepest-first renames to avoid parent conflicts.
find "$DEST_DIR" -depth -name '*entity*' | while read -r p; do
  newp="${p//entity/$SVC_LOWER}"
  mv "$p" "$newp"
done

# 2) Rename filenames containing 'entity' → '<svc>'
find "$DEST_DIR" -type f -name '*entity*' | while read -r f; do
  newf="${f//entity/$SVC_LOWER}"
  mv "$f" "$newf"
done

# 3) In-file replacements across the new service
#    Replace identifiers, imports, env prefixes, service name, pkg name.
replace_in_files() {
  local pattern="$1" replacement="$2"
  # Use Perl for safer cross-platform in-place (handles slashes)
  perl -0777 -pe "s/$pattern/$replacement/g" -i $(git ls-files -z "$DEST_DIR" 2>/dev/null | xargs -0 -I{} echo "{}") 2>/dev/null \
    || perl -0777 -pe "s/$pattern/$replacement/g" -i $(find "$DEST_DIR" -type f -name '*.ts' -o -name 'package.json' -o -name '*.md')
}

# Map:
# Entity → Geo (Pascal), entity → geo (lower), TEMPLATE_ → GEO_, "template" → "geo"
# NOTE: Order matters: replace PascalCase before lowercase to avoid partial collisions.
replace_in_files '\bEntity\b' "$SVC_PASCAL"
replace_in_files '\bentity\b' "$SVC_LOWER"
replace_in_files 'TEMPLATE_' "${SVC_UPPER}_"
replace_in_files 'SERVICE_NAME\s*=\s*"template"' "SERVICE_NAME = \"$SVC_LOWER\""
replace_in_files '@shared/contracts/entity\.contract' "@shared/contracts/${SVC_LOWER}.contract"

# Rename route file to <svc>.routes.ts if present
if [[ -f "$DEST_DIR/src/routes/entity.routes.ts" ]]; then
  mv "$DEST_DIR/src/routes/entity.routes.ts" "$DEST_DIR/src/routes/${SVC_LOWER}.routes.ts"
fi

# Update package.json "name"
if [[ -f "$DEST_DIR/package.json" ]]; then
  # Use jq if available, otherwise sed
  if command -v jq >/dev/null 2>&1; then
    tmp=$(mktemp)
    jq --arg n "${SVC_LOWER}-service" '.name=$n' "$DEST_DIR/package.json" > "$tmp" && mv "$tmp" "$DEST_DIR/package.json"
  else
    "${SED_I[@]}" "s/\"name\"\s*:\s*\"template-service\"/\"name\": \"${SVC_LOWER}-service\"/" "$DEST_DIR/package.json"
  fi
fi

# 4) Optional: remove DB/model if --no-db
if [[ "$NO_DB" == "true" ]]; then
  rm -f "$DEST_DIR/src/db.ts" 2>/dev/null || true
  rm -rf "$DEST_DIR/src/models" 2>/dev/null || true
  # Strip connectDb import/usage in index.ts
  if [[ -f "$DEST_DIR/index.ts" ]]; then
    "${SED_I[@]}" 's/^import { connectDb }.*\n//g' "$DEST_DIR/index.ts"
    "${SED_I[@]}" 's/^\s*await connectDb\(\);\s*\n//g' "$DEST_DIR/index.ts"
  fi
fi

# 5) Ensure shared contract exists (create a stub if missing)
if [[ ! -f "$SHARED_CONTRACT" ]]; then
  mkdir -p "$(dirname "$SHARED_CONTRACT")"
  cat > "$SHARED_CONTRACT" <<EOF
// backend/services/shared/contracts/${SVC_LOWER}.contract.ts
import { z } from "zod";

/**
 * Canonical contract for ${SVC_PASCAL}.
 * Replace with the real schema ASAP. This is the single source of truth.
 */
export const ${SVC_LOWER}Contract = z.object({
  _id: z.string(),             // Mongo ObjectId (string)
  dateCreated: z.string(),     // ISO timestamp
  dateLastUpdated: z.string(), // ISO timestamp

  // TODO: add real fields
  name: z.string().min(1),
});

export type ${SVC_PASCAL} = z.infer<typeof ${SVC_LOWER}Contract>;
EOF
  echo "Created stub contract: $SHARED_CONTRACT"
fi

# 6) Remind where to wire routes in app.ts (if path changed)
APP_TS="$DEST_DIR/src/app.ts"
if [[ -f "$APP_TS" ]]; then
  # swap entity route mount if present
  "${SED_I[@]}" "s@/entity@/${SVC_LOWER}@g" "$APP_TS"
  "${SED_I[@]}" "s@from \"\\./routes/entity\\.routes\"@from \"\\./routes/${SVC_LOWER}\\.routes\"@g" "$APP_TS"
fi

echo "✔ Service created: backend/services/${SVC_LOWER}"
echo "Next steps:"
echo "  1) Implement your canonical contract: backend/services/shared/contracts/${SVC_LOWER}.contract.ts"
echo "  2) Review handlers, repo, mapper, dto for ${SVC_PASCAL}-specific logic."
echo "  3) Add ENV: ${SVC_UPPER}_PORT, LOG_LEVEL, LOG_SERVICE_URL, and DB URI if applicable."
echo "  4) Start it:  (from repo root)  NODE_ENV=dev ENV_FILE=.env.dev yarn --cwd backend/services/${SVC_LOWER} dev"
