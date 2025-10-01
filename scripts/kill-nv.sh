# scripts/kill-nv.sh
#!/usr/bin/env bash
# =============================================================================
# NowVibin Kill Script — nuke all NV dev services cleanly (macOS Bash 3.2 OK)
# SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
# ADRs: ADR0001 rewrite, ADR0003 gateway→svcfacilitator mirror push
# Usage:
#   chmod +x scripts/kill-nv.sh
#   scripts/kill-nv.sh          # kill
#   scripts/kill-nv.sh --dry    # show what would be killed
# =============================================================================
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

DRY=0
for a in "$@"; do
  case "$a" in
    --dry|--dry-run) DRY=1 ;;
    *) echo "Usage: scripts/kill-nv.sh [--dry]"; exit 2 ;;
  esac
done

# ---- Known service path patterns --------------------------------------------
PATS=(
  "backend/services/gateway"
  "backend/services/svcfacilitator"
  "backend/services/auth"
  "backend/services/user"
  "backend/services/act"
  "backend/services/geo"
  "backend/services/audit"
  "backend/services/log"
)

# ---- Default dev ports (fallback) -------------------------------------------
PORTS=(4000 4001 4015 4010 4020 4030 4040 4050 4006)

# Pull PORT from each service’s .env.dev if present (no sourcing; comments safe)
get_env_port() {
  local dir="$1"
  local file="$ROOT/$dir/.env.dev"
  [ -f "$file" ] || return 0
  local p
  p="$(grep -E '^PORT=' "$file" | tail -n1 | cut -d'=' -f2- || true)"
  [ -n "$p" ] && PORTS+=("$p")
}
for d in "${PATS[@]}"; do get_env_port "$d"; done

# De-dup ports (bash 3.2 + set -u safe)
UNIQ_PORTS=()
for p in "${PORTS[@]}"; do
  found=0
  for u in "${UNIQ_PORTS[@]}"; do
    if [ "$u" = "$p" ]; then found=1; break; fi
  done
  [ $found -eq 0 ] && UNIQ_PORTS+=("$p")
done

kill_quiet(){ kill "$@" >/dev/null 2>&1 || true; }
pgid_of(){ ps -o pgid= -p "$1" 2>/dev/null | tr -d ' ' || true; }

kill_group(){ # <pgid> <label>
  local pg="$1" label="$2"
  [ -n "$pg" ] || return 0
  echo "🧯 Killing $label (PGID=$pg)…"
  [ $DRY -eq 1 ] && return 0
  # macOS-compatible: kill the whole process group (negative PGID)
  kill_quiet -TERM "-$pg"
  sleep 0.5
  kill_quiet -KILL "-$pg"
}

# Collect targets (unique process groups)
TARGET_PGIDS=()
TARGET_LABELS=()

add_target(){
  local pid="$1" label="$2"
  [ -n "$pid" ] || return 0
  [ "$pid" = "$$" ] && return 0
  local pg; pg="$(pgid_of "$pid")"
  [ -z "$pg" ] && pg="$pid"
  # de-dup by PGID
  for x in "${TARGET_PGIDS[@]}"; do [ "$x" = "$pg" ] && return 0; done
  TARGET_PGIDS+=("$pg")
  TARGET_LABELS+=("$label")
}

# 1) Find by repo path pattern (most precise)
pids=""
for pat in "${PATS[@]}"; do
  if command -v pgrep >/dev/null 2>&1; then
    pids="$(pgrep -f "$pat" 2>/dev/null || true)"
  else
    # fallback without pgrep
    pids="$(ps ax -o pid= -o command= | grep -E "$pat" | grep -v 'grep -E' | awk '{print $1}' || true)"
  fi
  for pid in $pids; do add_target "$pid" "$pat"; done
done

# 2) Also find by well-known dev ports (good fallback)
if command -v lsof >/dev/null 2>&1; then
  for port in "${UNIQ_PORTS[@]}"; do
    pids="$(lsof -ti tcp:$port 2>/dev/null || true)"
    for pid in $pids; do add_target "$pid" "port:$port"; done
  done
fi

count=${#TARGET_PGIDS[@]}
if [ "$count" -eq 0 ]; then
  echo "✅ No NV services found."
  exit 0
fi

echo "Found $count process group(s) to kill:"
for i in $(seq 0 $((count-1))); do
  echo " - ${TARGET_LABELS[$i]} (PGID=${TARGET_PGIDS[$i]})"
done
[ $DRY -eq 1 ] && { echo "(dry run — nothing killed)"; exit 0; }

# Kill in reverse order just in case
for i in $(seq $((count-1)) -1 0); do
  kill_group "${TARGET_PGIDS[$i]}" "${TARGET_LABELS[$i]}"
done

echo "🧼 Done. If anything still lingers, try:"
echo "    lsof -iTCP -sTCP:LISTEN | egrep ':4000|:4015|:4010|:4020|:4030|:4040|:4050|:4006'"
