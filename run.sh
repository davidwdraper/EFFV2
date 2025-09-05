# scripts/run.sh
#!/usr/bin/env bash
set -Eeuo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# NowVibin Dev Runner (services spawn with ENV_FILE propagated)
# - MODE: dev | docker
# - ENV_FILE: path to env file (default: .env.dev) — script-level default only
# - Never hard-codes .env.dev in service code; only the runner sets it.
# - NEW: Builds backend/services/shared before launching services.
# - NEW: Sources root .env.dev (universal NODE_ENV, etc.).
# - NEW: Per-service ENV_FILE support (defaults to root if service file missing).
# - NEW: Port cleanup across root + per-service env files.
# ─────────────────────────────────────────────────────────────────────────────

MODE="${1:-dev}"     # dev | docker
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# Allow override: ENV_FILE=/path/to/.env.something ./scripts/run.sh
ENV_FILE="${ENV_FILE:-.env.dev}"
# Normalize ENV_FILE to absolute path if relative
if [[ "$ENV_FILE" != /* ]]; then ENV_FILE="$ROOT/$ENV_FILE"; fi

echo "▶ run.sh starting MODE=$MODE (root=$ROOT)"
echo "   ENV_FILE=$ENV_FILE"

# ======= CONFIG: edit this list =======
# Each line: name|path|start-command
# Comment out a line with '#' to disable a service.
# NOTE: svcconfig starts BEFORE gateway so registry is up first.
SERVICES=(
  "svcconfig|backend/services/svcconfig|yarn dev"
  "gateway|backend/services/gateway|yarn dev"
  "gateway-core|backend/services/gateway-core|yarn dev"
  "geo|backend/services/geo|yarn dev"
  "act|backend/services/act|yarn dev"
  # "auth|backend/services/auth|yarn dev"
  # "image|backend/services/image|yarn dev"
  "user|backend/services/user|yarn dev"
  # "log|backend/services/log|yarn dev"
)

# ======= Clean shutdown =======
PIDS=[]
REDIS_PROC_PID=""
REDIS_DOCKER_ID=""
cleanup() {
  echo "🧹 Cleaning up..."
  if [[ -n "$REDIS_PROC_PID" ]] && ps -p "$REDIS_PROC_PID" >/dev/null 2>&1; then
    echo "🧯 Stopping redis-server (pid $REDIS_PROC_PID)"
    kill "$REDIS_PROC_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$REDIS_DOCKER_ID" ]]; then
    echo "🧯 Stopping dockerized Redis ($REDIS_DOCKER_ID)"
    docker stop "$REDIS_DOCKER_ID" >/dev/null 2>&1 || true
  fi
  if [[ "${#PIDS[@]}" -gt 0 ]]; then
    echo "🧯 Stopping services: ${PIDS[*]}"
    kill "${PIDS[@]}" >/dev/null 2>&1 || true
  fi
}
trap 'echo "🛑 Caught signal"; cleanup; exit 0' INT TERM
trap 'echo "💥 Error on line $LINENO"; cleanup; exit 1' ERR

# ======= Helpers =======
get_env() { # get key from env file without sourcing
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 1
  grep -E "^${key}=" "$file" | tail -n1 | cut -d'=' -f2- || true
}

# ======= Docker mode =======
if [[ "$MODE" == "docker" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "❌ ENV_FILE not found: $ENV_FILE"
    exit 1
  fi
  echo "🛳️  Starting docker compose with env file: $ENV_FILE"
  docker compose --env-file "$ENV_FILE" up --build
  exit 0
fi

# ======= Dev mode =======
if [[ "$MODE" != "dev" ]]; then
  echo "❌ Invalid mode. Usage: ENV_FILE=.env.dev ./scripts/run.sh [dev|docker]"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ ENV_FILE not found: $ENV_FILE"
  exit 1
fi

# ----- Load root env first (universal NODE_ENV, etc.) -----
ROOT_ENV="$ROOT/.env.dev"
if [[ -f "$ROOT_ENV" ]]; then
  echo "📦 Loading root env: $ROOT_ENV"
  set -a; source "$ROOT_ENV"; set +a
else
  echo "ℹ️  Root .env.dev not found; continuing without it."
fi

# ----- Build @shared before anything else -----
SHARED_DIR="$ROOT/backend/services/shared"
BUILD_HELPER="$ROOT/scripts/build-shared.sh"
echo "🛠️  Building @shared..."
if [[ -x "$BUILD_HELPER" ]]; then
  "$BUILD_HELPER"
else
  if [[ -d "$SHARED_DIR" ]]; then
    pushd "$SHARED_DIR" >/dev/null
    if command -v yarn >/dev/null 2>&1; then
      yarn tsc --build --clean
      yarn tsc --build
    else
      npx tsc --build --clean
      npx tsc --build
    fi
    popd >/dev/null
    echo "✅ @shared built."
  else
    echo "⚠️  Shared package not found at $SHARED_DIR (skipping build)"
  fi
fi

# ----- Determine per-service env files (prefer service-local .env.dev) -----
SERVICE_ENV_FILES=() # array of unique files to scan for ports
declare -A SERVICE_ENV_MAP

for line in "${SERVICES[@]}"; do
  # Skip empty/comment lines
  if echo "$line" | grep -Eq '^[[:space:]]*$'; then continue; fi
  if echo "$line" | grep -Eq '^[[:space:]]*#'; then continue; fi

  name="${line%%|*}"; rest="${line#*|}"
  path="${rest%%|*}"
  # Prefer per-service env file if it exists; else fall back to global ENV_FILE
  svc_env="$ROOT/$path/.env.dev"
  if [[ -f "$svc_env" ]]; then
    SERVICE_ENV_MAP["$name"]="$svc_env"
  else
    SERVICE_ENV_MAP["$name"]="$ENV_FILE"
  fi
done

# Collect unique env files for port cleanup
add_unique_env() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  for existing in "${SERVICE_ENV_FILES[@]:-}"; do
    [[ "$existing" == "$f" ]] && return 0
  done
  SERVICE_ENV_FILES+=("$f")
}
# include the root-passed ENV_FILE and the root env
add_unique_env "$ENV_FILE"
add_unique_env "$ROOT_ENV"
for k in "${!SERVICE_ENV_MAP[@]}"; do add_unique_env "${SERVICE_ENV_MAP[$k]}"; done

# ----- Robust port cleanup across all env files -----
echo "🧹 Killing anything on ports defined in:"
for f in "${SERVICE_ENV_FILES[@]}"; do echo "   • $(basename "$f")"; done

ports=""
for f in "${SERVICE_ENV_FILES[@]}"; do
  pf="$(grep -E '^[A-Z0-9_]+_PORT=' "$f" 2>/dev/null | sed -E 's/.*=//' | tr -d '"' | tr ' ' '\n' | grep -E '^[0-9]+$' || true)"
  ports="$ports $pf"
done

if [[ -z "${ports// /}" ]]; then
  echo "ℹ️  No *_PORT entries found in env files."
else
  for p in $ports; do
    [[ -z "$p" ]] && continue
    pids_on_port="$(lsof -ti "tcp:$p" 2>/dev/null || true)"
    if [[ -n "$pids_on_port" ]]; then
      echo "  • Killing PIDs on :$p → $pids_on_port"
      # shellcheck disable=SC2086
      kill -9 $pids_on_port 2>/dev/null || true
    else
      echo "  • No processes on :$p"
    fi
  done
fi

# ----- Redis (optional local) -----
# Prefer svcconfig's REDIS_URL if present; else global; else localhost
REDIS_URL="$(get_env "${SERVICE_ENV_MAP[svcconfig]:-$ENV_FILE}" REDIS_URL || true)"
if [[ -z "${REDIS_URL:-}" ]]; then
  REDIS_URL="$(get_env "$ENV_FILE" REDIS_URL || true)"
fi
if [[ -z "${REDIS_URL:-}" ]]; then
  REDIS_URL="redis://localhost:6379"
  echo "ℹ️  REDIS_URL not set; assuming $REDIS_URL for dev."
fi

needs_local_redis="false"
if echo "$REDIS_URL" | grep -Eq '^redis://(127\.0\.0\.1|localhost):6379(/.*)?$'; then
  needs_local_redis="true"
fi

if [[ "$needs_local_redis" == "true" ]]; then
  echo "🔎 Checking local Redis @ $REDIS_URL..."
  if command -v redis-cli >/dev/null 2>&1 && redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
    echo "✅ Redis already running."
  else
    echo "⚙️  Starting local redis-server (no persistence)..."
    if command -v redis-server >/dev/null 2>&1; then
      redis-server --save "" --appendonly no >/dev/null 2>&1 & REDIS_PROC_PID=$!
      sleep 0.5
      if command -v redis-cli >/dev/null 2>&1 && redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
        echo "✅ redis-server up (pid $REDIS_PROC_PID)."
      else
        echo "⚠️  redis-server started but not responding yet."
      fi
    elif command -v docker >/dev/null 2>&1; then
      echo "🐳 Launching Redis via Docker..."
      REDIS_DOCKER_ID="$(docker run -d --rm -p 6379:6379 --name nowvibin-redis redis:7-alpine)"
      sleep 0.8
      if command -v redis-cli >/dev/null 2>&1 && redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
        echo "✅ Docker Redis up (container $REDIS_DOCKER_ID)."
      else
        echo "⚠️  Docker Redis started but not responding yet."
      fi
    else
      echo "❌ No redis-server or docker available. Install Redis (brew install redis) or run Docker."
      exit 1
    fi
  fi
else
  echo "ℹ️  REDIS_URL points to remote; not starting local Redis."
fi

# ----- Build command list from SERVICES -----
NAMES=()
CMDS=()

echo "🧭 Services list:"
for line in "${SERVICES[@]}"; do
  # Skip empty or comment lines
  if echo "$line" | grep -Eq '^[[:space:]]*$'; then continue; fi
  if echo "$line" | grep -Eq '^[[:space:]]*#'; then
    echo "  • (disabled) $line"
    continue
  fi

  name="${line%%|*}"; rest="${line#*|}"
  path="${rest%%|*}"; cmd="${rest#*|}"
  name="$(echo "$name" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  path="$(echo "$path" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  cmd="$(echo "$cmd"  | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  [[ -z "$cmd" ]] && cmd="yarn dev"

  if [[ ! -d "$path" ]]; then
    echo "  • (missing)  $name → $path"
    continue
  fi

  # choose ENV_FILE for this service
  svc_env="${SERVICE_ENV_MAP[$name]:-$ENV_FILE}"
  echo "  • (enabled)  $name → $path :: $cmd  [ENV_FILE=$(basename "$svc_env")]"
  NAMES+=("$name")
  # Pass ENV_FILE to services; let each service bootstrap load it.
  CMDS+=("cd \"$path\" && ENV_FILE=\"$svc_env\" $cmd")
done

if [[ "${#NAMES[@]}" -eq 0 ]]; then
  echo "❌ No enabled services. Edit SERVICES in scripts/run.sh."
  exit 1
fi

# ----- Start everything (background) -----
echo "🚀 Starting services..."
for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"; cmd="${CMDS[$i]}"
  echo "→ $name"
  bash -lc "$cmd" & PIDS+=($!)
done

echo "📜 PIDs: ${PIDS[*]}"
echo "🟢 All services launched. Ctrl-C to stop."
wait
