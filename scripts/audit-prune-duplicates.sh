# /eff/scripts/audit-prune-duplicates.sh
#!/usr/bin/env bash
set -Eeuo pipefail

# Purpose: find and (optionally) remove files inside service trees that are
#          byte-identical duplicates of files under backend/services/shared/.
#
# Default: DRY-RUN (no deletions). Pass --apply to delete.
#
# Scope: gateway, gateway-core (can be extended with --svc)
#
# Strategy:
#  1) Build a SHA256 map of every file under backend/services/shared.
#  2) For each service, scan files under src/** (exclude node_modules, dist, coverage)
#     and if a file's SHA matches any shared file, mark it as duplicate.
#  3) Print a report; with --apply, delete duplicates and remove any now-empty dirs.
#
# Notes:
#  - We ONLY delete files that are byte-identical to a shared file.
#  - We DO NOT rewrite imports. If you were importing local duplicates,
#    adjust imports to "../../shared/..." or your @shared alias after pruning.
#  - Recommended: run with git clean working tree; commit after review.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

apply=""
services=( "gateway" "gateway-core" )

# ---- arg parse ----
while [ "$#" -gt 0 ]; do
  case "${1:-}" in
    --apply) apply="1"; shift ;;
    --svc)   shift; services=( "${1:-}" ); shift || true ;;
    -h|--help)
      cat <<'USAGE'
Usage: scripts/audit-prune-duplicates.sh [--apply] [--svc <service>]

Find (and optionally delete) duplicate files inside services that are identical
to files under backend/services/shared.

By default, DRY-RUN (no deletions). Use --apply to delete duplicates.

Examples:
  # Dry-run for gateway + gateway-core
  scripts/audit-prune-duplicates.sh

  # Actually delete duplicates
  scripts/audit-prune-duplicates.sh --apply

  # Only scan user-service later, if desired
  scripts/audit-prune-duplicates.sh --svc user
USAGE
      exit 0
      ;;
    *)
      echo "Unknown arg: ${1:-}" >&2; exit 2 ;;
  esac
done

shared_dir="${ROOT}/backend/services/shared"
[ -d "$shared_dir" ] || { echo "[err] Shared dir not found: $shared_dir" >&2; exit 1; }

# ---- build shared file hash map ----
declare -A SHARED_HASH_TO_PATHS
declare -A SHARED_PATH_TO_HASH

while IFS= read -r -d '' f; do
  # only regular files
  [ -f "$f" ] || continue
  hash="$(shasum -a 256 "$f" | awk '{print $1}')"
  rel="${f#$shared_dir/}"
  SHARED_PATH_TO_HASH["$rel"]="$hash"
  SHARED_HASH_TO_PATHS["$hash"]+="${SHARED_HASH_TO_PATHS[$hash]:+|}$rel"
done < <(find "$shared_dir" -type f -print0)

echo "[info] Indexed shared files: ${#SHARED_PATH_TO_HASH[@]}"

total_dups=0
deleted=0

for svc in "${services[@]}"; do
  svc_dir="${ROOT}/backend/services/${svc}"
  src_dir="${svc_dir}/src"
  [ -d "$src_dir" ] || { echo "[warn] Skip: $src_dir not found"; continue; }

  echo "────────────────────────────────────────────────────────"
  echo "[scan] ${svc}  (${src_dir})"
  svc_dups=()

  while IFS= read -r -d '' f; do
    # skip obvious build artifacts
    case "$f" in
      */node_modules/*|*/dist/*|*/coverage/*) continue ;;
    esac
    [ -f "$f" ] || continue
    hash="$(shasum -a 256 "$f" | awk '{print $1}')"
    shared_rel_candidates="${SHARED_HASH_TO_PATHS[$hash]:-}"
    [ -n "$shared_rel_candidates" ] || continue

    # Mark as duplicate (byte-identical to one or more shared files)
    svc_dups+=( "$f|$hash|$shared_rel_candidates" )
  done < <(find "$src_dir" -type f -print0)

  if [ "${#svc_dups[@]}" -eq 0 ]; then
    echo "[ok] No byte-identical duplicates found in $svc"
    continue
  fi

  echo "[report] ${#svc_dups[@]} duplicate file(s) in $svc:"
  for row in "${svc_dups[@]}"; do
    IFS='|' read -r file hash shared_list <<<"$row"
    echo "  - $file"
    echo "      sha256: $hash"
    IFS='|' read -r -a shared_paths <<<"$shared_list"
    for sp in "${shared_paths[@]}"; do
      echo "      matches shared: backend/services/shared/${sp}"
    done
  done

  total_dups=$(( total_dups + ${#svc_dups[@]} ))

  if [ -n "$apply" ]; then
    echo "[apply] Deleting duplicates in ${svc}…"
    for row in "${svc_dups[@]}"; do
      IFS='|' read -r file _ _ <<<"$row"
      rm -f -- "$file" && deleted=$((deleted + 1)) || true
    done
    # prune any empty directories left behind
    find "$src_dir" -type d -empty -delete
    echo "[apply] Deleted ${#svc_dups[@]} file(s) from ${svc} and pruned empty dirs."
  else
    echo "[dry-run] (no files deleted in ${svc})"
  fi
done

echo "────────────────────────────────────────────────────────"
echo "[summary] duplicates found: $total_dups"
if [ -n "$apply" ]; then
  echo "[summary] duplicates deleted: $deleted"
else
  echo "[summary] pass --apply to delete"
fi

# Exit non-zero if duplicates exist and we didn't apply, so CI can flag.
if [ -z "$apply" ] && [ "$total_dups" -gt 0 ]; then
  exit 3
fi
