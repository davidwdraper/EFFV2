#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# ──────────────────────────────────────────────────────────────────────────────
# Trap Ctrl-C and clean up (processes + optional local Redis)
# ──────────────────────────────────────────────────────────────────────────────
REDIS_PROC_PID=""
REDIS_DOCKER_ID=""
MODE="${1:-dev}"

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
  # Kill the concurrently process group
  kill 0 >/dev/null 2>&1 || true
}
trap 'echo "🛑 Caught Ctrl-C."; cleanup; exit 0' INT TERM

# ──────────────────────────────────────────────────────────────────────────────
# Services to run (dev mode)
# ──────────────────────────────────────────────────────────────────────────────
SERVICES=(
  gateway
  log
  user
  act
  auth
  image
)

# ──────────────────────────────────────────────────────────────────────────────
# Helper: load a key from .env file (very basic)
# ──────────────────────────────────────────────────────────────────────────────
get_env() {
  local file="$1"
  local key="$2"
  # shellcheck disable=SC2162
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^\ *# ]] && continue
    [[ -z "$k" ]] && continue
    if [[ "$k" == "$key" ]]; then
      echo "${v}"
      return 0
    fi
  done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$file" || true)
  return 1
}

# ──────────────────────────────────────────────────────────────────────────────
# Docker mode
# ──────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "docker" ]]; then
  echo "🛳️  Starting in DOCKER mode..."
  # Expect docker-compose.yml to define a 'redis' service; if not, add it.
  docker-compose --env-file .env.docker up --build
  exit 0
fi

# ──────────────────────────────────────────────────────────────────────────────
# Dev mode: start local Redis if needed, then start node services
# ──────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "dev" ]]; then
  if [[ ! -f ".env.dev" ]]; then
    echo "❌ .env.dev not found at repo root."
    exit 1
  fi

  echo "🧹 Killing any processes using service ports from .env.dev..."
  # Allow failures (no PIDs found)
  set +e
  grep _PORT .env.dev | cut -d '=' -f2 | xargs -I {} lsof -ti :{} 2>/dev/null | xargs kill -9 2>/dev/null
  set -e

  # ── Determine if we should bring up a local Redis in dev ────────────────────
  REDIS_URL="$(get_env .env.dev REDIS_URL || true)"
  # Default to localhost if unset (your shared bootstrap may still require it explicitly)
  if [[ -z "${REDIS_URL}" ]]; then
    REDIS_URL="redis://localhost:6379"
    echo "ℹ️  REDIS_URL not set in .env.dev — assuming ${REDIS_URL} for dev."
  fi

  needs_local_redis="false"
  if [[ "$REDIS_URL" =~ ^redis://(127\.0\.0\.1|localhost):6379(/.*)?$ ]]; then
    needs_local_redis="true"
  fi

  if [[ "$needs_local_redis" == "true" ]]; then
    echo "🔎 Checking local Redis at ${REDIS_URL}..."
    if command -v redis-cli >/dev/null 2>&1 && redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
      echo "✅ Redis is already running."
    else
      echo "⚙️  Starting local Redis for dev..."
      if command -v redis-server >/dev/null 2>&1; then
        # Lightweight: no persistence for dev speed
        redis-server --save "" --appendonly no >/dev/null 2>&1 &
        REDIS_PROC_PID=$!
        # Wait briefly for readiness
        sleep 0.4
        if command -v redis-cli >/dev/null 2>&1 && redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
          echo "✅ redis-server up (pid $REDIS_PROC_PID)."
        else
          echo "⚠️  redis-server started but not responding yet."
        fi
      elif command -v docker >/dev/null 2>&1; then
        echo "🐳 Launching Redis via Docker..."
        REDIS_DOCKER_ID="$(docker run -d --rm -p 6379:6379 --name nowvibin-redis redis:7-alpine)"
        # Brief wait
        sleep 0.8
        if command -v redis-cli >/dev/null 2>&1 && redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
          echo "✅ Docker Redis up (container $REDIS_DOCKER_ID)."
        else
          echo "⚠️  Docker Redis started but not responding yet."
        fi
      else
        echo "❌ No local redis-server or docker available. Install Redis (brew install redis) or run Docker."
        exit 1
      fi
    fi
  else
    echo "ℹ️  REDIS_URL points to a remote host. Not starting local Redis."
  fi

  echo "💻 Starting available services with concurrently..."
  COMMANDS=()
  NAMES=()

  for service in "${SERVICES[@]}"; do
    path="backend/services/$service"
    if [[ -d "$path" ]]; then
      COMMANDS+=("cd $path && NODE_ENV=dev dotenv -e ../../../.env.dev -- yarn dev")
      NAMES+=("$service")
    else
      echo "⚠️  Skipping missing service: $service"
    fi
  done

  npx concurrently \
    --kill-others-on-fail \
    --names "$(IFS=,; echo "${NAMES[*]}")" \
    --prefix "[{name}]" \
    "${COMMANDS[@]}"

  # If concurrently exits, cleanup handles Redis stop too.
  cleanup
  exit 0
fi

echo "❌ Invalid mode. Usage: ./run.sh [dev|docker]"
exit 1
