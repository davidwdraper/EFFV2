#!/usr/bin/env bash
# build-session-files.sh — run from ~/eff
# Copies listed files into session-files/ with slashes replaced by underscores.

set -euo pipefail

DEST="session-files"
mkdir -p "$DEST"

# copy helper: expands globs; warns if missing.
copy_one() {
  local pattern="$1"
  shopt -s nullglob
  local matched=0
  for src in $pattern; do
    matched=1
    if [[ -e "$src" ]]; then
      local tgt="${src//\//_}"
      # print the cp command (as you requested) and perform it
      echo "cp $src $DEST/$tgt"
      cp "$src" "$DEST/$tgt"
    fi
  done
  shopt -u nullglob
  if [[ $matched -eq 0 ]]; then
    echo "WARN: no match for '$pattern'" >&2
  fi
}

# === File list (comments removed) ===
copy_one "backend/services/act/vitest.config.ts"
copy_one "backend/services/act/test/setup.ts"
copy_one "backend/services/act/.env.test"
copy_one "backend/services/act/test/helpers/mongo.ts"
copy_one "backend/services/act/test/helpers/server.ts"
copy_one "backend/services/act/test/seed/factories.ts"
copy_one "backend/services/act/test/seed/runBeforeEach.ts"
copy_one "backend/services/act/test/act.more-coverage.spec.ts"
copy_one "backend/services/act/test/act.search.spec.ts"
copy_one "backend/services/act/test/act.controller.branches.extra.spec.ts"
copy_one "backend/services/act/test/act.controller.branches.more2.spec.ts"
copy_one "backend/services/act/src/app.ts"
copy_one "backend/services/act/src/routes/actRoutes.ts"
copy_one "backend/services/act/src/controllers/actController.ts"
# expand all handler files (*.ts)
copy_one "backend/services/act/src/controllers/act/handlers/*.ts"
copy_one "backend/services/act/src/repo/actRepo.ts"
copy_one "backend/services/act/src/lib/search.ts"
copy_one "backend/services/act/src/models/Act.ts"
copy_one "backend/services/act/src/dto/actDto.ts"
copy_one "backend/services/act/src/db.ts"

echo "Done. Files are in '$DEST/'."
