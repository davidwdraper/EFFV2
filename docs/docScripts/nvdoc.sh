# docs/docScripts/nvdoc.sh
#!/usr/bin/env bash
# NV Docs helper (macOS Bash 3.2 friendly)
# Manage the append-only Architecture Line Items file with tagged facts.
# Usage:
#   docs/docScripts/nvdoc.sh add "[ARCH][BE][AUDIT] your fact"
#   docs/docScripts/nvdoc.sh sort            # writes LINE_ITEMS.sorted.md
#   docs/docScripts/nvdoc.sh sort --in-place # overwrites LINE_ITEMS.md (optional)
#   docs/docScripts/nvdoc.sh lint            # verify format
#   docs/docScripts/nvdoc.sh tags            # list unique first tags in use
set -euo pipefail

# Resolve repo root (git) or fallback to cwd
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DOC="$ROOT/docs/architecture/LINE_ITEMS.md"
SORTED="$ROOT/docs/architecture/LINE_ITEMS.sorted.md"

now_utc() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

ensure_file() {
  mkdir -p "$(dirname "$DOC")"
  if [ ! -f "$DOC" ]; then
    {
      echo "# Architecture Line Items (Tagged, Append-Only)"
      echo
      echo "> Format each fact as:"
      echo "> - YYYY-MM-DDTHH:MM:SSZ [TAG] your fact here"
      echo
      echo "# Append new facts below this line (one per line)"
    } >"$DOC"
  fi
}

# portable first-tag extractor (prints the first [TAG] if present)
first_tag_of() {
  awk 'match($0, /\[[^]]+\]/){print substr($0, RSTART, RLENGTH); exit}' <<<"$1"
}

cmd_add() {
  ensure_file
  local msg="${1-}"
  if [ -z "${msg:-}" ]; then
    echo "Usage: $0 add \"[ARCH][BE][AUDIT] your fact\"" >&2
    exit 64
  fi
  case "$msg" in
    \[*\]* ) : ;;
    * ) echo "Line must start with [TAG] (e.g., [ARCH][BE][AUDIT])" >&2; exit 64;;
  esac

  local first_tag
  first_tag="$(first_tag_of "$msg")"
  if [ -n "$first_tag" ] && [ "$first_tag" != "[ARCH]" ] && [ "$first_tag" != "[DESIGN]" ]; then
    echo "Note: consider starting with [ARCH] or [DESIGN] as the first tag." >&2
  fi

  printf -- "- %s %s\n" "$(now_utc)" "$msg" >>"$DOC"
  echo "Appended to $DOC"
}

# Write a sorted view (by FIRST tag, then timestamp). Header lines preserved.
cmd_sort() {
  ensure_file
  local in_place="${1-}"

  local head body keyed sorted_lines
  head="$SORTED.tmp.head"
  body="$SORTED.tmp.body"
  keyed="$SORTED.tmp.keyed"
  sorted_lines="$SORTED.tmp.sorted"

  # Split header vs bullets (header = lines not starting with "- ")
  awk '
    /^- / { print > ENVIRON["BODY"]; next }
    { print > ENVIRON["HEAD"] }
  ' HEAD="$head" BODY="$body" "$DOC"

  # Build sort keys: first tag + timestamp (assumes "- <ts> [TAG] ...")
  awk -v OFS='\t' '
    {
      # extract first [TAG]
      tag="[ZZZ]"
      if (match($0, /\[[^]]+\]/)) { tag=substr($0, RSTART, RLENGTH) }
      # timestamp is 2nd token
      ts=$2
      print tag, ts, $0
    }
  ' "$body" >"$keyed"

  LC_ALL=C sort -k1,1 -k2,2 "$keyed" | cut -f3- >"$sorted_lines"
  cat "$head" "$sorted_lines" >"$SORTED"
  rm -f "$head" "$body" "$keyed" "$sorted_lines"

  if [ "$in_place" = "--in-place" ]; then
    mv "$SORTED" "$DOC"
    echo "Rewrote $DOC in-place (sorted by first tag, then timestamp)."
  else
    echo "Wrote sorted view to $SORTED (original left untouched)."
  fi
}

# Verify bullets match the expected pattern
cmd_lint() {
  ensure_file
  local bad=0
  while IFS= read -r line; do
    case "$line" in
      "- "*) 
        ts="$(awk '{print $2}' <<<"$line")"
        tag="$(first_tag_of "$line")"
        if ! printf "%s" "$ts" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'; then
          echo "Bad timestamp: $line" >&2; bad=1
        fi
        if [ -z "$tag" ]; then
          echo "Missing first [TAG]: $line" >&2; bad=1
        fi
        ;;
      *) : ;;
    esac
  done <"$DOC"

  if [ $bad -ne 0 ]; then exit 1; fi
  echo "lint OK"
}

cmd_tags() {
  ensure_file
  awk 'match($0, /\[[^]]+\]/){print substr($0, RSTART, RLENGTH)}' "$DOC" | sort -u
}

case "${1-}" in
  add) shift; cmd_add "${*:-}" ;;
  sort) shift; cmd_sort "${1-}" ;;
  lint) cmd_lint ;;
  tags) cmd_tags ;;
  ""|-h|--help|help)
    cat <<EOF
Usage:
  $0 add "[ARCH][BE][AUDIT] your fact"
  $0 sort [--in-place]
  $0 lint
  $0 tags

Notes:
- Always start with a [TAG]; prefer [ARCH] or [DESIGN] as the first tag.
- Sorted view groups by FIRST tag, then timestamp.
EOF
    ;;
  *)
    echo "Unknown command: $1" >&2
    exit 64
    ;;
esac
