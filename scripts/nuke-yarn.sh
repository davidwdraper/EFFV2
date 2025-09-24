#!/usr/bin/env bash
# scripts/nuke-yarn.sh
# Purge Yarn artifacts from the repo. DRY-RUN by default; pass --apply to delete.

set -Eeuo pipefail
APPLY=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    *) echo "Usage: scripts/nuke-yarn.sh [--apply]"; exit 2 ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

echo "▶ Searching for Yarn artifacts to remove (root=$ROOT)"
mapfile -t TARGETS < <(
  find "$ROOT" -type f -name "yarn.lock" -print
  find "$ROOT" -type f -name ".yarnrc" -print
  find "$ROOT" -type f -name ".yarnrc.yml" -print
  find "$ROOT" -type f -path "*/.yarn/releases/*" -print
  find "$ROOT" -type d -name ".yarn" -print
  find "$ROOT" -type f -name ".pnp.cjs" -print
  find "$ROOT" -type f -name ".pnp.loader.mjs" -print
)

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "✅ Nothing to remove."
  exit 0
fi

echo "— Candidates:"
for t in "${TARGETS[@]}"; do
  echo "   • ${t#$ROOT/}"
done

if [[ $APPLY -eq 0 ]]; then
  echo "ℹ️  DRY-RUN: nothing deleted. Re-run with --apply to remove the above."
  exit 0
fi

echo "💣 Deleting…"
for t in "${TARGETS[@]}"; do
  if [[ -d "$t" ]]; then
    rm -rf "$t"
  else
    rm -f "$t"
  fi
done
echo "✅ Removed Yarn artifacts."

echo "ℹ️  You may now run:"
echo "    corepack enable && corepack prepare pnpm@9 --activate && pnpm install"
