# docs/docScripts/adrdoc.sh
#!/usr/bin/env bash
set -Eeuo pipefail

#───────────────────────────────────────────────────────────────────────────────
# Docs:
# - ADR folder: docs/adr
# - SOP: docs/architecture/backend/SOP.md  (anchors the ADR workflow)
#
# Why:
# - ADRs capture the *reasoning* behind decisions. This script lets you create a
#   fully populated ADR in one shot—no “fill this later” busywork—so the context
#   doesn’t get lost between commits.
#
# Notes:
# - Auto-increments ADR id unless --id is provided (format: 0001).
# - Slugifies the title; writes front-matter and full sections.
# - Section flags accept inline text or @file to read content from disk.
# - Safe-by-default: refuses to overwrite unless --force.
# - Portable: avoids process substitution; runs on older Bash and POSIX shells.
#───────────────────────────────────────────────────────────────────────────────

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ADR_DIR="$REPO_ROOT/docs/adr"

usage() {
  cat <<'USAGE'
Usage:
  docs/docScripts/adrdoc.sh "Title" [--status STATUS] [--deciders "Alice,Bob"] [--supersedes 0003] [--tags "security,auth"]
                              [--id 0042] [--force]
                              [--context TEXT|@file]
                              [--decision TEXT|@file]
                              [--consequences TEXT|@file]
                              [--alternatives TEXT|@file]
                              [--references TEXT|@file]
USAGE
  exit 1
}

slugify() {
  # lowercase, replace non-alnum with '-', squeeze/trims '-'
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]/-/g' -e 's/-\{2,\}/-/g' -e 's/^-//' -e 's/-$//'
}

read_arg_or_file() {
  # If arg starts with @, read that file; otherwise echo the arg as-is.
  local v="$1"
  if [ -n "$v" ] && [ "${v#@}" != "$v" ]; then
    local p="${v#@}"
    if [ ! -f "$p" ]; then
      printf 'ERR: file not found: %s\n' "$p" >&2
      exit 3
    fi
    cat "$p"
  else
    printf '%s' "$v"
  fi
}

next_id() {
  mkdir -p "$ADR_DIR"
  local max=0
  # Loop files safely without process substitution
  for f in "$ADR_DIR"/[0-9][0-9][0-9][0-9]-*.md; do
    [ -e "$f" ] || continue
    # Extract leading 4 digits
    local base n num
    base="$(basename "$f")"
    n="$(printf '%s' "$base" | sed -n 's/^\([0-9][0-9][0-9][0-9]\)-.*\.md$/\1/p')"
    if [ -n "$n" ]; then
      # 10# protects from octal interpretation
      num=$((10#$n))
      if [ "$num" -gt "$max" ]; then max="$num"; fi
    fi
  done
  printf '%04d' $((max + 1))
}

# Defaults
title=""
status="Proposed"
deciders=""
supersedes=""
tags=""
force="false"
id=""

context=""
decision=""
consequences=""
alternatives=""
references=""

# Parse
[ $# -lt 1 ] && usage
title="$1"; shift || true

while [ $# -gt 0 ]; do
  case "$1" in
    --status)         status="${2:-}"; shift 2 || usage ;;
    --deciders)       deciders="${2:-}"; shift 2 || usage ;;
    --supersedes)     supersedes="${2:-}"; shift 2 || usage ;;
    --tags)           tags="${2:-}"; shift 2 || usage ;;
    --id)             id="${2:-}"; shift 2 || usage ;;
    --force)          force="true"; shift ;;
    --context)        context="$(read_arg_or_file "${2:-}")"; shift 2 || usage ;;
    --decision)       decision="$(read_arg_or_file "${2:-}")"; shift 2 || usage ;;
    --consequences)   consequences="$(read_arg_or_file "${2:-}")"; shift 2 || usage ;;
    --alternatives)   alternatives="$(read_arg_or_file "${2:-}")"; shift 2 || usage ;;
    --references)     references="$(read_arg_or_file "${2:-}")"; shift 2 || usage ;;
    -h|--help)        usage ;;
    *) printf 'Unknown arg: %s\n' "$1"; usage ;;
  esac
done

# Normalize/validate
if [ -z "$title" ]; then printf 'ERR: Title is required.\n' >&2; usage; fi
if [ -n "$id" ] && ! printf '%s' "$id" | grep -Eq '^[0-9]{4}$'; then
  printf 'ERR: --id must be four digits like 0042\n' >&2; exit 4
fi

# Compute id and paths
id="${id:-$(next_id)}"
slug="$(slugify "$title")"
file="$ADR_DIR/$id-$slug.md"
date_str="$(date +%F)"

if [ -e "$file" ] && [ "$force" != "true" ]; then
  printf 'ERR: %s already exists. Use --force to overwrite.\n' "$file" >&2
  exit 2
fi

mkdir -p "$ADR_DIR"

# Front-matter optional fields
fm_deciders=""
fm_supersedes=""
fm_tags=""
[ -n "$deciders" ]   && fm_deciders="deciders: [$(printf '%s' "$deciders" | sed 's/, */, /g')]"
[ -n "$supersedes" ] && fm_supersedes="supersedes: $supersedes"
if [ -n "$tags" ]; then
  norm_tags="$(printf '%s' "$tags" | sed 's/, \+/,/g; s/ \+/,/g; s/,,\+/,/g; s/^,//; s/,$//; s/,/, /g')"
  fm_tags="tags: [${norm_tags}]"
fi

# Safe defaults to keep file readable if sections omitted
[ -z "$context" ]      && context="(fill in: problem, constraints, forces)"
[ -z "$decision" ]     && decision="(fill in: the choice and *why now*)"
[ -z "$consequences" ] && consequences="(fill in: tradeoffs, risks, ops costs)"
[ -z "$alternatives" ] && alternatives="(fill in: considered options & tradeoffs)"
[ -z "$references" ]   && references="- SOP: docs/architecture/backend/SOP.md"

# Write file
{
  printf -- '---\n'
  printf 'id: %s\n' "$id"
  printf 'title: %s\n' "$title"
  printf 'date: %s\n' "$date_str"
  printf 'status: %s\n' "$status"
  [ -n "$fm_deciders" ]   && printf '%s\n' "$fm_deciders"
  [ -n "$fm_supersedes" ] && printf '%s\n' "$fm_supersedes"
  [ -n "$fm_tags" ]       && printf '%s\n' "$fm_tags"
  printf -- '---\n\n'
  printf '# Status\n%s\n\n' "$status"
  printf '# Context\n%s\n\n' "$context"
  printf '# Decision\n%s\n\n' "$decision"
  printf '# Consequences\n%s\n\n' "$consequences"
  printf '# Alternatives Considered\n%s\n\n' "$alternatives"
  printf '# References\n%s\n' "$references"
} > "$file"

printf '✅ ADR created: %s\n' "$file"
