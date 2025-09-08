# scripts/rename-template.sh
#!/usr/bin/env bash
# Rename a cloned "template" service tree to a new slug (e.g., audit).
# macOS Bash 3.2 friendly. No process substitution, no arrays in dry-run.
#
# Usage:
#   bash scripts/rename-template.sh <new-slug> [--root <dir>] [--dry-run]

set -euo pipefail

# ---------- args ----------
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <new-slug> [--root <dir>] [--dry-run]" >&2
  exit 64
fi

NEW_SLUG="$1"; shift || true
ROOT="."
DRY_RUN=0

while [[ "${1-}" == --* ]]; do
  case "$1" in
    --root) ROOT="${2-}"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    *) echo "Unknown option: $1" >&2; exit 64;;
  esac
done

# ---------- helpers ----------
to_upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }
cap_first() { printf '%s%s' "$(printf '%s' "${1:0:1}" | tr '[:lower:]' '[:upper:]')" "${1:1}"; }
is_text_ext() {
  case "$1" in
    *.ts|*.tsx|*.js|*.cjs|*.mjs|*.json|*.md|*.txt|*.yaml|*.yml|*.sh|*.env|*.env.*|*.[Dd]ockerfile|*.conf) return 0 ;;
    *) return 1 ;;
  esac
}
filesize_bytes() { wc -c <"$1" 2>/dev/null | tr -d ' '; }

# ---------- variants ----------
if [[ ! "$NEW_SLUG" =~ ^[a-z0-9-]+$ ]]; then
  echo "New slug must be lowercase letters, numbers, or dashes: '$NEW_SLUG'" >&2
  exit 64
fi
SRC_L="template"; SRC_C="Template"; SRC_U="TEMPLATE"
DST_L="$NEW_SLUG"; DST_C="$(cap_first "$NEW_SLUG")"; DST_U="$(to_upper "$NEW_SLUG")"

if [[ ! -d "$ROOT" ]]; then
  echo "Root directory not found: $ROOT" >&2; exit 66
fi
ROOT="$(cd "$ROOT" && pwd)"

echo "== NowVibin rename =="
echo "Root:   $ROOT"
echo "From:   $SRC_L | $SRC_C | $SRC_U"
echo "To:     $DST_L | $DST_C | $DST_U"
echo "DryRun: $DRY_RUN"
echo

# ---------- step 1: rename paths (or preview) ----------
if [[ $DRY_RUN -eq 0 ]]; then
  echo "-- Renaming paths ..."
  find "$ROOT" \( -name .git -o -name node_modules -o -name dist -o -name build \) -prune -o \
    -depth -print0 |
  while IFS= read -r -d '' P; do
    case "$P" in *"$SRC_L"*|*"$SRC_C"*|*"$SRC_U"*) ;; *) continue;; esac
    DEST="$P"
    DEST="${DEST//$SRC_U/$DST_U}"
    DEST="${DEST//$SRC_C/$DST_C}"
    DEST="${DEST//$SRC_L/$DST_L}"
    if [[ "$DEST" != "$P" ]]; then
      mkdir -p "$(dirname "$DEST")"
      mv "$P" "$DEST"
      echo "renamed: $P -> $DEST"
    fi
  done
else
  echo "-- Paths after renaming (preview):"
  # Recompute would-be destination names and print only changed ones
  find "$ROOT" \( -name .git -o -name node_modules -o -name dist -o -name build \) -prune -o \
    -depth -print0 |
  while IFS= read -r -d '' P; do
    case "$P" in *"$SRC_L"*|*"$SRC_C"*|*"$SRC_U"*) ;; *) continue;; esac
    DEST="$P"
    DEST="${DEST//$SRC_U/$DST_U}"
    DEST="${DEST//$SRC_C/$DST_C}"
    DEST="${DEST//$SRC_L/$DST_L}"
    if [[ "$DEST" != "$P" ]]; then
      echo "  $DEST"
    fi
  done
fi

echo

# ---------- step 2: rewrite file contents ----------
echo "-- Rewriting file contents ..."
find "$ROOT" \( -name .git -o -name node_modules -o -name dist -o -name build \) -prune -o \
  -type f -print0 |
while IFS= read -r -d '' F; do
  is_text_ext "$F" || continue
  sz="$(filesize_bytes "$F" || echo 0)"
  [[ "$sz" -gt 5242880 ]] && { echo "skip (size>5MB): $F"; continue; }

  if grep -q "$SRC_L\|$SRC_C\|$SRC_U" "$F"; then
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "edit: $F"
    else
      perl -0777 -pe '
        s/'"$SRC_U"'/'"$DST_U"'/g;
        s/'"$SRC_C"'/'"$DST_C"'/g;
        s/'"$SRC_L"'/'"$DST_L"'/g;
      ' -i -- "$F"
      echo "edited: $F"
    fi
  fi
done

echo
echo "✅ Done."
