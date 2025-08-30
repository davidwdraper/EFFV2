#!/usr/bin/env bash
# scripts/run.sh
set -Eeuo pipefail

# ======= CONFIG: edit this list =======
# Each line: name|path|start-command
# Comment out a line with '#' to disable a service.
SERVICES=(
  "gateway|backend/services/gateway|yarn dev"
  "gateway-core|backend/services/gateway-core|yarn dev"
  "geo|backend/services/geo|yarn dev"
  "act|backend/services/act|yarn dev"
  # "auth|backend/services/auth|yarn dev"
  # "image|backend/services/image|yarn dev"
  # "user|backend/services/user|yarn dev"
  # "log|backend/services/log|yarn dev"
)

MODE="${1:-dev}"   # dev | docker
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

echo "▶ run.sh starting in MODE=$MODE (root=$ROOT)"

# ======= Clean shutdown =======
PIDS=()
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
get_env() { # get key from .env.dev
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 1
  grep -E "^${key}=" "$file" | tail -n1 | cut -d'=' -f2- || true
}

# ======= Docker mode =======
if [[ "$MODE" == "docker" ]]; then
  echo "🛳️  Starting docker compose..."
  docker compose --env-file .env.docker up --build
  exit 0
fi

# ======= Dev mode =======
if [[ "$MODE" != "dev" ]]; then
  echo "❌ Invalid mode. Usage: ./scripts/run.sh [dev|docker]"
  exit 1
fi

[[ -f ".env.dev" ]] || { echo "❌ .env.dev not found at repo root ($ROOT)"; exit 1; }

# ----- Robust port cleanup (no fragile pipes) -----
echo "🧹 Killing anything on ports from .env.dev..."
ports="$(grep -E '^[A-Z0-9_]+_PORT=' .env.dev 2>/dev/null | sed -E 's/.*=//' | tr -d '"' | tr ' ' '\n' | grep -E '^[0-9]+$' || true)"
if [[ -z "${ports}" ]]; then
  echo "ℹ️  No *_PORT entries found in .env.dev"
else
  for p in ${ports}; do
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
REDIS_URL="$(get_env .env.dev REDIS_URL || true)"
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

# ----- Build command list from SERVICES (comments respected) -----
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

  echo "  • (enabled)  $name → $path :: $cmd"
  NAMES+=("$name")
  # Use dotenv from repo root so all services share the same .env.dev
  CMDS+=("cd \"$path\" && NODE_ENV=dev npx -y dotenv -e \"$ROOT/.env.dev\" -- $cmd")
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
