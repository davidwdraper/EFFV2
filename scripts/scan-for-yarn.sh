#!/usr/bin/env bash
# scripts/scan-for-yarn.sh
# Find remaining Yarn references, ignoring node_modules & yarn.lock by default.
# Use --all to include everything.

set -Eeuo pipefail

INCLUDE_ALL=0
for a in "$@"; do
  case "$a" in
    --all) INCLUDE_ALL=1 ;;
    *) echo "Usage: scripts/scan-for-yarn.sh [--all]"; exit 2 ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

echo "▶ Scanning for 'yarn' (root=$ROOT)"
[[ $INCLUDE_ALL -eq 1 ]] && echo "   Mode: INCLUDE ALL (node_modules & yarn.lock included)" || echo "   Mode: DEFAULT (node_modules & yarn.lock excluded)"

# ignore lists
IGNORE_DIRS=(
  ".git"
  ".pnpm-store"
  ".turbo"
  ".parcel-cache"
  ".cache"
  "dist"
  "build"
  ".next"
  "coverage"
  ".idea"
  ".vscode"
  ".yarn/cache"
  ".yarn/unplugged"
)

if [[ $INCLUDE_ALL -eq 0 ]]; then
  IGNORE_DIRS+=("node_modules")
fi

RG_IGNORES=()
GREP_FIND_PRUNE=()
for d in "${IGNORE_DIRS[@]}"; do
  RG_IGNORES+=( "-g" "!$d/**" )
  GREP_FIND_PRUNE+=( -path "$ROOT/$d" -prune -o )
done

PATTERNS_CONTENT=( "yarn " "yarn@" "yarnpkg" "yarn\.js" )
PATTERNS_FILES=( ".yarnrc" ".yarnrc.yml" ".yarn/releases" )
# Only include yarn.lock in file hits when --all
if [[ $INCLUDE_ALL -eq 1 ]]; then
  PATTERNS_FILES+=( "yarn.lock" )
fi

FOUND=0

echo "— Checking for Yarn-named files…"
while IFS= read -r -d '' f; do
  echo "FILE  : ${f#$ROOT/}"
  FOUND=1
done < <(
  find "$ROOT" \
    \( "${GREP_FIND_PRUNE[@]}" -false \) \
    -o \( -type f \( $(printf -- '-name %q -o ' "${PATTERNS_FILES[@]}") -false \) -print0 \)
)

echo "— Grepping for Yarn usage in file contents…"
if command -v rg >/dev/null 2>&1; then
  ALT="$(printf '%s|' "${PATTERNS_CONTENT[@]}")"; ALT="${ALT%|}"
  # exclude yarn.lock unless --all
  LOCK_EX="-g !**/yarn.lock"
  [[ $INCLUDE_ALL -eq 1 ]] && LOCK_EX=
  rg --no-ignore-vcs --hidden "${RG_IGNORES[@]}" $LOCK_EX \
     --line-number --color=never --pcre2 \
     -e "$ALT" \
     -- :"$ROOT" \
     | sed "s#^$ROOT/##" \
     | awk '{print "MATCH : " $0;}' && FOUND=1 || true
else
  while IFS= read -r -d '' f; do
    # skip yarn.lock unless --all
    if [[ $INCLUDE_ALL -eq 0 && "${f##*/}" == "yarn.lock" ]]; then continue; fi
    if grep -I -n -E 'yarn |yarn@|yarnpkg|yarn\.js' "$f" >/dev/null 2>&1; then
      grep -I -n -E 'yarn |yarn@|yarnpkg|yarn\.js' "$f" \
        | sed "s#^$ROOT/##" \
        | awk -v file="${f#$ROOT/}" -F: '{print "MATCH : " $0;}'
      FOUND=1
    fi
  done < <(
    find "$ROOT" \
      \( "${GREP_FIND_PRUNE[@]}" -false \) \
      -o \( -type f -print0 \)
  )
fi

echo "— Quick package.json script audit (yarn invocations)…"
if command -v jq >/dev/null 2>&1; then
  while IFS= read -r -d '' pkg; do
    rel="${pkg#$ROOT/}"
    if jq -e '.scripts? | type=="object"' "$pkg" >/dev/null 2>&1; then
      jq -r '.scripts | to_entries[] | "\(.key): \(.value)"' "$pkg" \
        | grep -E '(^|[[:space:]])yarn([[:space:]:]|$)' \
        | awk -v file="$rel" '{print "PKG   : " file " :: " $0;}' && FOUND=1 || true
    fi
  done < <(find "$ROOT" \( "${GREP_FIND_PRUNE[@]}" -false \) -o \( -name package.json -type f -print0 \))
else
  echo "PKG   : (jq not found; skipping script audit)"
fi

echo
if [[ $FOUND -eq 0 ]]; then
  echo "✅ No actionable Yarn references found (with current ignore rules)."
  echo "   Tip: run with --all to scan node_modules and yarn.lock too."
else
  echo "⚠️  Actionable Yarn references found. See FILE/MATCH/PKG lines above."
  echo "    Convert remaining scripts to pnpm equivalents where needed."
fi
