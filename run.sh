#!/usr/bin/env bash
# scripts/run.sh
# NowVibin Dev Runner (prod-parity friendly) — KMS/JWKS inline export for gateway (+ --test shell export)
# macOS Bash 3.2 compatible (no assoc arrays, no process substitution)
#
# WHY:
# - Keep service code free of dev-only logic.
# - Start services with consistent env (prod-like).
# - Guarantee the gateway sees KMS_* at boot (inline injection), even if dotenv loads empty strings upstream.
# - When --test is used, export ONLY gateway KMS_* (plus derived aliases) into THIS shell as well.
# - Enforce ADC via GOOGLE_APPLICATION_CREDENTIALS in all modes (dev == prod).

set -Eeuo pipefail

# ======= Arg parsing =========================================================
NV_TEST=0
MODE=""
for a in "$@"; do
  case "$a" in
    --test) NV_TEST=1 ;;
    dev|docker) MODE="$a" ;;
    *) echo "❌ Unknown arg: $a"; echo "Usage: ENV_FILE=.env.dev ./scripts/run.sh [--test] [dev|docker]"; exit 2 ;;
  esac
done
[[ -z "$MODE" ]] && MODE="dev"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# Allow override: ENV_FILE=/path/to/.env.something ./scripts/run.sh
ENV_FILE="${ENV_FILE:-.env.dev}"
if [[ "$ENV_FILE" != /* ]]; then ENV_FILE="$ROOT/$ENV_FILE"; fi

echo "▶ run.sh starting MODE=$MODE (root=$ROOT)"
echo "   ENV_FILE=$ENV_FILE"
[[ $NV_TEST -eq 1 ]] && echo "   TEST MODE: exporting KMS_* for gateway (shell-only)"

# ======= Service list ========================================================
SERVICES=(
  "svcconfig|backend/services/svcconfig|yarn dev"
  "gateway|backend/services/gateway|yarn dev"
  # enable more as needed:
  # "audit|backend/services/audit|yarn dev"
  # "geo|backend/services/geo|yarn dev"
  # "act|backend/services/act|yarn dev"
  # "auth|backend/services/auth|yarn dev"
  # "user|backend/services/user|yarn dev"
  # "log|backend/services/log|yarn dev"
  # "template|backend/services/template|yarn dev"
)

# ======= Helpers =============================================================
get_env() { local file="$1" key="$2"; [[ -f "$file" ]] || return 1; grep -E "^${key}=" "$file" | tail -n1 | cut -d'=' -f2- || true; }
has_script() { node -e "try{const s=require('./package.json').scripts||{};process.exit(s['$1']?0:1)}catch(e){process.exit(1)}" >/dev/null 2>&1; }
has_cmd() { command -v "$1" >/dev/null 2>&1; }
trim() { echo "$1" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'; }
mk_crypto_key() { # projects/<proj>/locations/<loc>/keyRings/<ring>/cryptoKeys/<key>
  local proj="$1" loc="$2" ring="$3" key="$4"
  echo "projects/${proj}/locations/${loc}/keyRings/${ring}/cryptoKeys/${key}"
}

# ======= Gateway env file (for KMS reads) ===================================
GW_ENV_FILE_DEFAULT="$ROOT/backend/services/gateway/.env.dev"
GW_ENV_FILE="${GATEWAY_ENV:-$GW_ENV_FILE_DEFAULT}"

# ======= Optional: export KMS_* for gateway when --test ======================
if [[ $NV_TEST -eq 1 ]]; then
  if [[ ! -f "$GW_ENV_FILE" ]]; then
    echo "❌ --test requested but gateway env not found: $GW_ENV_FILE" >&2
    exit 1
  fi
  # Export only KMS_* lines to THIS shell (ignore comments/blank)
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" != KMS_*'='* ]] && continue
    key="${line%%=*}"; val="${line#*=}"
    [[ -z "$key" || "$key" == "$line" ]] && continue
    val="${val%\"}"; val="${val#\"}"
    export "$key"="$val"
  done < "$GW_ENV_FILE"

  # Derive aliases (compute even if some parts are empty; it's dev—be transparent)
  KMS_PROJECT_ID="${KMS_PROJECT_ID:-}"
  KMS_LOCATION_ID="${KMS_LOCATION_ID:-}"
  KMS_KEY_RING_ID="${KMS_KEY_RING_ID:-}"
  KMS_KEY_ID="${KMS_KEY_ID:-}"
  KMS_CRYPTO_KEY="$(mk_crypto_key "$KMS_PROJECT_ID" "$KMS_LOCATION_ID" "$KMS_KEY_RING_ID" "$KMS_KEY_ID")"
  export KMS_CRYPTO_KEY
  # Aliases for clarity/consistency across code paths
  export KMS_KEY_NAME="$KMS_CRYPTO_KEY"
  export KMS_SIGN_KEY_ID="$KMS_KEY_ID"
  export KMS_JWKS_KEY_ID="$KMS_KEY_ID"

  echo "   → KMS parts: project=${KMS_PROJECT_ID:-<unset>}  location=${KMS_LOCATION_ID:-<unset>}  ring=${KMS_KEY_RING_ID:-<unset>}  key=${KMS_KEY_ID:-<unset>}"
  echo "   → KMS resource: ${KMS_CRYPTO_KEY}"

  # ADC message (informational only; does NOT bypass ADC requirement for runs)
  if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    if [[ -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
      echo "   → ADC: using GOOGLE_APPLICATION_CREDENTIALS ($GOOGLE_APPLICATION_CREDENTIALS)"
    else
      echo "   ⚠️  GOOGLE_APPLICATION_CREDENTIALS set but file not found: $GOOGLE_APPLICATION_CREDENTIALS"
    fi
  elif has_cmd gcloud && gcloud auth application-default print-access-token >/dev/null 2>&1; then
    echo "   → ADC: gcloud application-default credentials detected (dev convenience)"
  else
    echo "   ⚠️  No ADC detected. For parity set:"
    echo "      • export GOOGLE_APPLICATION_CREDENTIALS=\$HOME/.config/nowvibin/gateway-dev.json"
  fi
fi

# ======= Docker mode =========================================================
if [[ "$MODE" == "docker" ]]; then
  [[ -f "$ENV_FILE" ]] || { echo "❌ ENV_FILE not found: $ENV_FILE"; exit 1; }
  echo "🛳️  Starting docker compose with env file: $ENV_FILE"
  echo "   Passing to services: ENV_FILE=$(basename "$ENV_FILE")  GATEWAY_ENV=$(basename "$ENV_FILE")"
  docker compose --env-file "$ENV_FILE" up --build
  exit 0
fi

# ======= Dev mode ============================================================
[[ "$MODE" == "dev" ]] || { echo "❌ Invalid mode. Usage: ENV_FILE=.env.dev ./scripts/run.sh [--test] [dev|docker]"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "❌ ENV_FILE not found: $ENV_FILE"; exit 1; }

# ---- Parity guard: require ADC via SA file in all environments --------------
if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" || ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
  echo "❌ GOOGLE_APPLICATION_CREDENTIALS not set or file missing."
  echo "   Set it to your gateway SA JSON and retry."
  echo "   Example:"
  echo "     export GOOGLE_APPLICATION_CREDENTIALS=\"\$HOME/.config/nowvibin/gateway-dev.json\""
  exit 1
fi
echo "✓ ADC via SA file: $GOOGLE_APPLICATION_CREDENTIALS"

ROOT_ENV="$ROOT/.env.dev"
if [[ -f "$ROOT_ENV" ]]; then
  echo "📦 Loading root globals from: $ROOT_ENV"
  export NODE_ENV="$(get_env "$ROOT_ENV" NODE_ENV || echo dev)"
  export LOG_LEVEL="$(get_env "$ROOT_ENV" LOG_LEVEL || echo debug)"
  export LOG_SERVICE_URL="$(get_env "$ROOT_ENV" LOG_SERVICE_URL || true)"
  export LOG_SERVICE_TOKEN_CURRENT="$(get_env "$ROOT_ENV" LOG_SERVICE_TOKEN_CURRENT || true)"
  export LOG_SERVICE_TOKEN_NEXT="$(get_env "$ROOT_ENV" LOG_SERVICE_TOKEN_NEXT || true)"
else
  echo "ℹ️  Root .env.dev not found; continuing without it."
fi

# Workspace deps
if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "📦 Installing workspace dependencies..."
  (cd "$ROOT" && yarn install)
fi

# Build @eff/shared first
SHARED_DIR="$ROOT/backend/services/shared"
echo "🛠️  Building @eff/shared..."
if [[ -d "$SHARED_DIR" ]]; then
  pushd "$SHARED_DIR" >/dev/null
  PKG_NAME="$(node -p "try{require('./package.json').name}catch(e){''}" 2>/dev/null || true)"
  [[ "$PKG_NAME" == "@eff/shared" ]] || { echo "❌ backend/services/shared/package.json 'name' must be '@eff/shared' (found '$PKG_NAME')"; exit 1; }

  if has_script clean; then
    if has_cmd rimraf; then yarn run clean || true
    else echo "ℹ️  rimraf not found; using rm -rf for clean"; rm -rf dist tsconfig.tsbuildinfo || true
    fi
  else
    rm -rf dist tsconfig.tsbuildinfo || true
  fi

  if has_script build; then yarn run build
  else
    if has_cmd yarn; then yarn dlx typescript tsc -p tsconfig.json
    else npx -y typescript tsc -p tsconfig.json
    fi
  fi

  [[ -f "dist/index.js" ]] || { echo "❌ @eff/shared build produced no dist/index.js"; exit 1; }
  popd >/dev/null
  echo "✅ @eff/shared built."
else
  echo "❌ Shared package not found at $SHARED_DIR"
  exit 1
fi

# Map services → env files
SERVICE_NAMES=(); SERVICE_PATHS=(); SERVICE_CMDS=(); SERVICE_ENVFILES=()
for line in "${SERVICES[@]}"; do
  [[ -z "${line// }" ]] && continue
  case "$line" in \#*) continue ;; esac
  name="${line%%|*}"; rest="${line#*|}"
  path="${rest%%|*}"; cmd="${rest#*|}"
  name="$(trim "$name")"; path="$(trim "$path")"; cmd="$(trim "$cmd")"
  [[ -z "$cmd" ]] && cmd="yarn dev"
  [[ -d "$path" ]] || { echo "  • (missing)  $name → $path"; continue; }
  svc_env="$ROOT/$path/.env.dev"; [[ -f "$svc_env" ]] || svc_env="$ENV_FILE"
  SERVICE_NAMES+=("$name"); SERVICE_PATHS+=("$path"); SERVICE_CMDS+=("$cmd"); SERVICE_ENVFILES+=("$svc_env")
done

# Collect unique env files (port cleanup)
SERVICE_ENV_FILES=()
add_unique_env() { local f="$1"; [[ -f "$f" ]] || return 0; for e in "${SERVICE_ENV_FILES[@]:-}"; do [[ "$e" == "$f" ]] && return 0; done; SERVICE_ENV_FILES+=("$f"); }
add_unique_env "$ENV_FILE"; add_unique_env "$ROOT_ENV"
for f in "${SERVICE_ENVFILES[@]}"; do add_unique_env "$f"; done

echo "🧹 Killing anything on ports defined in:"
for f in "${SERVICE_ENV_FILES[@]}"; do echo "   • $(basename "$f")"; done

ports=""
for f in "${SERVICE_ENV_FILES[@]}"; do
  pf="$(grep -E '^[A-Z0-9_]+_PORT=' "$f" 2>/dev/null | sed -E 's/.*=//' | tr -d '\"' | tr ' ' '\n' | grep -E '^[0-9]+$' || true)"
  ports="$ports $pf"
done
if [[ -n "${ports// /}" ]]; then
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
else
  echo "ℹ️  No *_PORT entries found in env files."
fi

# Redis (optional local)
REDIS_PROC_PID=""; REDIS_DOCKER_ID=""
REDIS_URL=""
for i in "${!SERVICE_NAMES[@]}"; do
  if [[ "${SERVICE_NAMES[$i]}" == "svcconfig" ]]; then
    REDIS_URL="$(get_env "${SERVICE_ENVFILES[$i]}" REDIS_URL || true)"; break
  fi
done
[[ -n "${REDIS_URL:-}" ]] || REDIS_URL="$(get_env "$ENV_FILE" REDIS_URL || true)"
[[ -n "${REDIS_URL:-}" ]] || { REDIS_URL="redis://localhost:6379"; echo "ℹ️  REDIS_URL not set; assuming $REDIS_URL for dev."; }
needs_local_redis="false"
if echo "$REDIS_URL" | grep -Eq '^redis://(127\.0\.0\.1|localhost):6379(/.*)?$'; then needs_local_redis="true"; fi
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

# ----- Start everything (background) -----------------------------------------
echo "🧭 Services list:"
for i in "${!SERVICE_NAMES[@]}"; do
  name="${SERVICE_NAMES[$i]}"; path="${SERVICE_PATHS[$i]}"; cmd="${SERVICE_CMDS[$i]}"; svc_env="${SERVICE_ENVFILES[$i]}"
  echo "  • (enabled)  $name → $path :: $cmd  [ENV_FILE=$(basename "$svc_env")]"
done
echo "   Passing to services: ENV_FILE=$(basename "$ENV_FILE")  GATEWAY_ENV=$(basename "$ENV_FILE")"

PIDS=()
echo "🚀 Starting services..."
for i in "${!SERVICE_NAMES[@]}"; do
  name="${SERVICE_NAMES[$i]}"
  path="${SERVICE_PATHS[$i]}"
  cmd="${SERVICE_CMDS[$i]}"
  svc_env="${SERVICE_ENVFILES[$i]}"

  if [[ "$name" == "gateway" ]]; then
    # Read KMS parts from gateway env file
    KMS_PROJECT_ID_GW="$(get_env "$GW_ENV_FILE" KMS_PROJECT_ID || echo "")"
    KMS_LOCATION_ID_GW="$(get_env "$GW_ENV_FILE" KMS_LOCATION_ID || echo "")"
    KMS_KEY_RING_ID_GW="$(get_env "$GW_ENV_FILE" KMS_KEY_RING_ID || echo "")"
    KMS_KEY_ID_GW="$(get_env "$GW_ENV_FILE" KMS_KEY_ID || echo "")"
    KMS_CRYPTO_KEY_GW="$(mk_crypto_key "$KMS_PROJECT_ID_GW" "$KMS_LOCATION_ID_GW" "$KMS_KEY_RING_ID_GW" "$KMS_KEY_ID_GW")"

    # Aliases
    KMS_KEY_NAME_GW="$KMS_CRYPTO_KEY_GW"
    KMS_SIGN_KEY_ID_GW="$KMS_KEY_ID_GW"
    KMS_JWKS_KEY_ID_GW="$KMS_KEY_ID_GW"

    echo "→ gateway inline KMS:"
    echo "   parts: proj=${KMS_PROJECT_ID_GW:-<unset>}  loc=${KMS_LOCATION_ID_GW:-<unset>}  ring=${KMS_KEY_RING_ID_GW:-<unset>}  key=${KMS_KEY_ID_GW:-<unset>}"
    echo "   full : ${KMS_CRYPTO_KEY_GW}"
    echo "   ADC  : GOOGLE_APPLICATION_CREDENTIALS=${GOOGLE_APPLICATION_CREDENTIALS}"

    # Pass BOTH ENV_FILE and GATEWAY_ENV, plus inline KMS_* and aliases and ADC path
    bash -lc "cd \"$path\" \
      && ENV_FILE=\"$svc_env\" GATEWAY_ENV=\"$svc_env\" \
         GOOGLE_APPLICATION_CREDENTIALS=\"$GOOGLE_APPLICATION_CREDENTIALS\" \
         KMS_PROJECT_ID=\"$KMS_PROJECT_ID_GW\" \
         KMS_LOCATION_ID=\"$KMS_LOCATION_ID_GW\" \
         KMS_KEY_RING_ID=\"$KMS_KEY_RING_ID_GW\" \
         KMS_KEY_ID=\"$KMS_KEY_ID_GW\" \
         KMS_CRYPTO_KEY=\"$KMS_CRYPTO_KEY_GW\" \
         KMS_KEY_NAME=\"$KMS_KEY_NAME_GW\" \
         KMS_SIGN_KEY_ID=\"$KMS_SIGN_KEY_ID_GW\" \
         KMS_JWKS_KEY_ID=\"$KMS_JWKS_KEY_ID_GW\" \
         $cmd" & PIDS+=($!)
  else
    bash -lc "cd \"$path\" && ENV_FILE=\"$svc_env\" GATEWAY_ENV=\"$svc_env\" $cmd" & PIDS+=($!)
  fi
done

echo "📜 PIDs: ${PIDS[*]}"
echo "🟢 All services launched. Ctrl-C to stop."

cleanup() {
  echo "🧹 Cleaning up..."
  if [[ -n "$REDIS_PROC_PID" ]] && ps -p "$REDIS_PROC_PID" >/dev/null 2>&1; then
    echo "🧯 Stopping redis-server (pid $REDIS_PROC_PID)"; kill "$REDIS_PROC_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$REDIS_DOCKER_ID" ]]; then
    echo "🧯 Stopping dockerized Redis ($REDIS_DOCKER_ID)"; docker stop "$REDIS_DOCKER_ID" >/dev/null 2>&1 || true
  fi
  if [[ "${#PIDS[@]}" -gt 0 ]]; then
    echo "🧯 Stopping services: ${PIDS[*]}"; kill "${PIDS[@]}" >/dev/null 2>&1 || true
  fi
}
trap 'echo "🛑 Caught signal"; cleanup; exit 0' INT TERM
trap 'echo "💥 Error on line $LINENO"; cleanup; exit 1' ERR

wait
