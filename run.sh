# scripts/run.sh
#!/usr/bin/env bash
set -Eeuo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# NowVibin Dev Runner (services spawn with ENV_FILE propagated)
# - MODE: dev | docker
# - ENV_FILE: path to env file (default: .env.dev)
# - Never hard-codes env inside services; only the runner sets ENV_FILE.
# - Builds backend/services/shared (@eff/shared) before launching services.
# - Loads a SAFE subset of root .env.dev (no risky `source`).
# - Portable on macOS Bash 3.2 (no assoc arrays, no process substitution).
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
  #"audit|backend/services/audit|yarn dev"
  "gateway|backend/services/gateway|yarn dev"
  #"geo|backend/services/geo|yarn dev"
  #"act|backend/services/act|yarn dev"
  #"auth|backend/services/auth|yarn dev"
  # "image|backend/services/image|yarn dev"
  #"user|backend/services/user|yarn dev"
  #"log|backend/services/log|yarn dev"
  #"template|backend/services/template|yarn dev"
)

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
get_env() { # get key from env file without sourcing
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 1
  grep -E "^${key}=" "$file" | tail -n1 | cut -d'=' -f2- || true
}
has_script() { # check if a yarn script exists in package.json (current dir)
  node -e "try{const s=require('./package.json').scripts||{};process.exit(s['$1']?0:1)}catch(e){process.exit(1)}" >/dev/null 2>&1
}
has_cmd() { command -v "$1" >/dev/null 2>&1; }

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

# ----- Load a SAFE subset from root env (no 'source' of pipes) -----
ROOT_ENV="$ROOT/.env.dev"
if [[ -f "$ROOT_ENV" ]]; then
  echo "📦 Loading root globals from: $ROOT_ENV"
  export NODE_ENV="$(get_env "$ROOT_ENV" NODE_ENV || echo dev)"
  export LOG_LEVEL="$(get_env "$ROOT_ENV" LOG_LEVEL || echo debug)"
  # Optional shared logger config used by non-log services:
  export LOG_SERVICE_URL="$(get_env "$ROOT_ENV" LOG_SERVICE_URL || true)"
  export LOG_SERVICE_TOKEN_CURRENT="$(get_env "$ROOT_ENV" LOG_SERVICE_TOKEN_CURRENT || true)"
  export LOG_SERVICE_TOKEN_NEXT="$(get_env "$ROOT_ENV" LOG_SERVICE_TOKEN_NEXT || true)"
else
  echo "ℹ️  Root .env.dev not found; continuing without it."
fi

# Ensure workspace deps once
if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "📦 Installing workspace dependencies..."
  (cd "$ROOT" && yarn install)
fi

# ----- Build @eff/shared before anything else -----
SHARED_DIR="$ROOT/backend/services/shared"
echo "🛠️  Building @eff/shared..."
if [[ -d "$SHARED_DIR" ]]; then
  pushd "$SHARED_DIR" >/dev/null

  # Validate package name
  PKG_NAME="$(node -p "try{require('./package.json').name}catch(e){''}" 2>/dev/null || true)"
  if [[ "$PKG_NAME" != "@eff/shared" ]]; then
    echo "❌ backend/services/shared/package.json 'name' must be '@eff/shared' (found '$PKG_NAME')"
    exit 1
  fi

  # Clean then build (prefer package scripts; fallbacks are Berry-safe)
  if has_script clean; then
    # If rimraf is missing, fall back to rm -rf
    if has_cmd rimraf; then
      yarn run clean || true
    else
      echo "ℹ️  rimraf not found; using rm -rf for clean"
      rm -rf dist tsconfig.tsbuildinfo || true
    fi
  else
    rm -rf dist tsconfig.tsbuildinfo || true
  fi

  if has_script build; then
    yarn run build
  else
    # Berry-safe fallback (no reliance on 'yarn tsc')
    if has_cmd yarn; then
      yarn dlx typescript tsc -p tsconfig.json
    else
      npx -y typescript tsc -p tsconfig.json
    fi
  fi

  # Verify artifacts exist
  if [[ ! -f "dist/index.js" ]]; then
    echo "❌ @eff/shared build produced no dist/index.js"
    exit 1
  fi

  popd >/dev/null
  echo "✅ @eff/shared built."
else
  echo "❌ Shared package not found at $SHARED_DIR"
  exit 1
fi

# ----- Determine per-service env files (portable, no assoc arrays, no proc-subst) -----
SERVICE_NAMES=()
SERVICE_PATHS=()
SERVICE_CMDS=()
SERVICE_ENVFILES=()

for line in "${SERVICES[@]}"; do
  # skip empty and comments
  [[ -z "${line// }" ]] && continue
  case "$line" in \#* ) continue ;; esac

  name="${line%%|*}"; rest="${line#*|}"
  path="${rest%%|*}"; cmd="${rest#*|}"

  # trim whitespace
  name="$(echo "$name" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  path="$(echo "$path" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  cmd="$(echo  "$cmd"  | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  [[ -z "$cmd" ]] && cmd="yarn dev"

  if [[ ! -d "$path" ]]; then
    echo "  • (missing)  $name → $path"
    continue
  fi

  svc_env="$ROOT/$path/.env.dev"
  if [[ ! -f "$svc_env" ]]; then svc_env="$ENV_FILE"; fi

  SERVICE_NAMES+=("$name")
  SERVICE_PATHS+=("$path")
  SERVICE_CMDS+=("$cmd")
  SERVICE_ENVFILES+=("$svc_env")
done

# Collect unique env files for port cleanup
SERVICE_ENV_FILES=()
add_unique_env() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  for existing in "${SERVICE_ENV_FILES[@]:-}"; do
    [[ "$existing" == "$f" ]] && return 0
  done
  SERVICE_ENV_FILES+=("$f")
}
add_unique_env "$ENV_FILE"
add_unique_env "$ROOT_ENV"
for f in "${SERVICE_ENVFILES[@]}"; do add_unique_env "$f"; done

# ----- Robust port cleanup across all env files -----
echo "🧹 Killing anything on ports defined in:"
for f in "${SERVICE_ENV_FILES[@]}"; do echo "   • $(basename "$f")"; done

ports=""
for f in "${SERVICE_ENV_FILES[@]}"; do
  pf="$(grep -E '^[A-Z0-9_]+_PORT=' "$f" 2>/dev/null | sed -E 's/.*=//' | tr -d '\"' | tr ' ' '\n' | grep -E '^[0-9]+$' || true)"
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
REDIS_URL=""
for i in "${!SERVICE_NAMES[@]}"; do
  if [[ "${SERVICE_NAMES[$i]}" == "svcconfig" ]]; then
    REDIS_URL="$(get_env "${SERVICE_ENVFILES[$i]}" REDIS_URL || true)"
    break
  fi
done
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
  if has_cmd redis-cli && redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
    echo "✅ Redis already running."
  else
    echo "⚙️  Starting local redis-server (no persistence)..."
    if has_cmd redis-server; then
      redis-server --save "" --appendonly no >/dev/null 2>&1 & REDIS_PROC_PID=$!
      sleep 0.5
      if has_cmd redis-cli && redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
        echo "✅ redis-server up (pid $REDIS_PROC_PID)."
      else
        echo "⚠️  redis-server started but not responding yet."
      fi
    elif has_cmd docker; then
      echo "🐳 Launching Redis via Docker..."
      REDIS_DOCKER_ID="$(docker run -d --rm -p 6379:6379 --name nowvibin-redis redis:7-alpine)"
      sleep 0.8
      if has_cmd redis-cli && redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
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

# ----- Start everything (background) -----
echo "🧭 Services list:"
for i in "${!SERVICE_NAMES[@]}"; do
  name="${SERVICE_NAMES[$i]}"
  path="${SERVICE_PATHS[$i]}"
  cmd="${SERVICE_CMDS[$i]}"
  svc_env="${SERVICE_ENVFILES[$i]}"
  echo "  • (enabled)  $name → $path :: $cmd  [ENV_FILE=$(basename "$svc_env")]"
done

echo "🚀 Starting services..."
for i in "${!SERVICE_NAMES[@]}"; do
  path="${SERVICE_PATHS[$i]}"
  cmd="${SERVICE_CMDS[$i]}"
  svc_env="${SERVICE_ENVFILES[$i]}"
  bash -lc "cd \"$path\" && ENV_FILE=\"$svc_env\" $cmd" & PIDS+=($!)
done

echo "📜 PIDs: ${PIDS[*]}"
echo "🟢 All services launched. Ctrl-C to stop."
wait
