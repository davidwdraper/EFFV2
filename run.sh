#!/usr/bin/env bash
# =============================================================================
# NowVibin Dev Runner (prod-parity) — KMS/JWKS inline export for gateway
# macOS Bash 3.2 compatible (no assoc arrays, no process substitution)
# =============================================================================

set -Eeuo pipefail
export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/nowvibin/gateway-dev.json}"
export GATEWAY_INTERNAL_BASE_URL="http://127.0.0.1:4001"
export GATEWAY_INTERNAL_PORT="4001"

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
[[ "$ENV_FILE" != /* ]] && ENV_FILE="$ROOT/$ENV_FILE"

echo "▶ run.sh starting MODE=$MODE (root=$ROOT)"
echo "   ENV_FILE=$ENV_FILE"
[[ $NV_TEST -eq 1 ]] && echo "   TEST MODE: exporting KMS_* for gateway (shell-only)"

# ======= Service list ========================================================
SERVICES=(
  "svcconfig|backend/services/svcconfig|pnpm dev"
  "gateway|backend/services/gateway|pnpm dev"
  "audit|backend/services/audit|pnpm dev"
  # "geo|backend/services/geo|pnpm dev"
  # "act|backend/services/act|pnpm dev"
  "auth|backend/services/auth|pnpm dev"
  "user|backend/services/user|pnpm dev"
  # "log|backend/services/log|pnpm dev"
  # "template|backend/services/template|pnpm dev"
)

# ======= Helpers =============================================================
get_env() { local file="$1" key="$2"; [[ -f "$file" ]] || return 1; grep -E "^${key}=" "$file" | tail -n1 | cut -d'=' -f2- || true; }
has_cmd() { command -v "$1" >/dev/null 2>&1; }
trim() { echo "$1" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'; }
mk_crypto_key() { local proj="$1" loc="$2" ring="$3" key="$4"; echo "projects/${proj}/locations/${loc}/keyRings/${ring}/cryptoKeys/${key}"; }

# ======= Gateway env file (for KMS reads) ===================================
GW_ENV_FILE_DEFAULT="$ROOT/backend/services/gateway/.env.dev"
GW_ENV_FILE="${GATEWAY_ENV:-$GW_ENV_FILE_DEFAULT}"

# ======= Optional: export KMS_* for gateway when --test ======================
if [[ $NV_TEST -eq 1 ]]; then
  if [[ ! -f "$GW_ENV_FILE" ]]; then
    echo "❌ --test requested but gateway env not found: $GW_ENV_FILE" >&2
    exit 1
  fi
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" != KMS_*'='* ]] && continue
    key="${line%%=*}"; val="${line#*=}"
    val="${val%\"}"; val="${val#\"}"
    export "$key"="$val"
  done < "$GW_ENV_FILE"

  KMS_PROJECT_ID="${KMS_PROJECT_ID:-}"
  KMS_LOCATION_ID="${KMS_LOCATION_ID:-}"
  KMS_KEY_RING_ID="${KMS_KEY_RING_ID:-}"
  KMS_KEY_ID="${KMS_KEY_ID:-}"
  KMS_CRYPTO_KEY="$(mk_crypto_key "$KMS_PROJECT_ID" "$KMS_LOCATION_ID" "$KMS_KEY_RING_ID" "$KMS_KEY_ID")"
  export KMS_CRYPTO_KEY
  export KMS_KEY_NAME="$KMS_CRYPTO_KEY"
  export KMS_SIGN_KEY_ID="$KMS_KEY_ID"
  export KMS_JWKS_KEY_ID="$KMS_KEY_ID"

  echo "   → KMS parts: project=${KMS_PROJECT_ID:-<unset>}  location=${KMS_LOCATION_ID:-<unset>}  ring=${KMS_KEY_RING_ID:-<unset>}  key=${KMS_KEY_ID:-<unset>}"
  echo "   → KMS resource: ${KMS_CRYPTO_KEY}"

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
  export NODE_ENV="$(get_env "$ROOT_ENV" NODE_ENV || echo development)"
  export LOG_LEVEL="$(get_env "$ROOT_ENV" LOG_LEVEL || echo debug)"
  export LOG_SERVICE_URL="$(get_env "$ROOT_ENV" LOG_SERVICE_URL || true)"
  export LOG_SERVICE_TOKEN_CURRENT="$(get_env "$ROOT_ENV" LOG_SERVICE_TOKEN_CURRENT || true)"
  export LOG_SERVICE_TOKEN_NEXT="$(get_env "$ROOT_ENV" LOG_SERVICE_TOKEN_NEXT || true)"
else
  echo "ℹ️  Root .env.dev not found; using built-in defaults."
  export NODE_ENV="${NODE_ENV:-development}"
  export LOG_LEVEL="${LOG_LEVEL:-debug}"
fi
echo "🔧 NODE_ENV=${NODE_ENV}  LOG_LEVEL=${LOG_LEVEL}"

# ======= Build @eff/shared (project refs) ====================================
diag_shared_build() {
  local TSC_RUNNER="$1"
  echo "——— TSC DIAGNOSTICS (@eff/shared) ———"
  echo "• cwd: $(pwd)"
  echo "• tsc version:"; $TSC_RUNNER -v 2>&1 || true
  echo; echo "• Raw --showConfig:"; $TSC_RUNNER -p tsconfig.json --showConfig 2>/dev/null || echo "  (could not run --showConfig)"
  echo; echo "• Emitted files:"; $TSC_RUNNER -p tsconfig.json --listEmittedFiles 2>/dev/null || echo "  (none)"
  echo "———————————————————————————————"
}
SHARED_DIR="$ROOT/backend/services/shared"
echo "🛠️  Building @eff/shared (workspace tsc -b)…"
if [[ -d "$SHARED_DIR" ]]; then
  if pnpm -w exec tsc -v >/dev/null 2>&1; then
    pnpm -w exec tsc -b "$SHARED_DIR" || { echo "❌ @eff/shared build failed (project refs)"; exit 1; }
  else
    npx -y typescript tsc -b "$SHARED_DIR" || { echo "❌ @eff/shared build failed (npx fallback)"; exit 1; }
  fi
  [[ -f "$SHARED_DIR/dist/index.js" ]] || { echo "❌ @eff/shared did not emit dist/index.js"; (cd "$SHARED_DIR" && diag_shared_build "pnpm exec tsc"); exit 1; }
  echo "✅ @eff/shared built (dist/index.js present)."
else
  echo "❌ Shared package not found at $SHARED_DIR"; exit 1
fi

# ======= Sync ports from svcconfig → .env.dev (PORT=…) =======================
echo "🔧 Syncing service ports from svcconfig → .env.dev (PORT=…)…"
node scripts/sync/sync_ports_from_svcconfig.cjs
echo "✅ Ports synced from svcconfig"

# Map services → env files (for launching only)
SERVICE_NAMES=(); SERVICE_PATHS=(); SERVICE_CMDS=(); SERVICE_ENVFILES=()
for line in "${SERVICES[@]}"; do
  [[ -z "${line// }" ]] && continue
  case "$line" in \#*) continue ;; esac
  name="${line%%|*}"; rest="${line#*|}"
  path="${rest%%|*}"; cmd="${rest#*|}"
  name="$(trim "$name")"; path="$(trim "$path")"; cmd="$(trim "$cmd")"
  [[ -z "$cmd" ]] && cmd="pnpm dev"
  [[ -d "$path" ]] || { echo "  • (missing)  $name → $path"; continue; }
  svc_env="$ROOT/$path/.env.dev"; [[ -f "$svc_env" ]] || svc_env="$ENV_FILE"
  SERVICE_NAMES+=("$name"); SERVICE_PATHS+=("$path"); SERVICE_CMDS+=("$cmd"); SERVICE_ENVFILES+=("$svc_env")
done

# --- Auto-derive SVCCONFIG_BASE_URL from svcconfig .env.dev (no drift) -------
SVC_ENV_SVCCONFIG="$ROOT/backend/services/svcconfig/.env.dev"
SVCCONFIG_BASE_URL_AUTO=""
if [[ -f "$SVC_ENV_SVCCONFIG" ]]; then
  __p="$(get_env "$SVC_ENV_SVCCONFIG" PORT || true)"
  if [[ -n "${__p:-}" ]] && echo "$__p" | grep -Eq '^[0-9]+$'; then
    SVCCONFIG_BASE_URL_AUTO="http://127.0.0.1:${__p}"
  fi
fi

# ----- Start everything (background) -----------------------------------------
echo "🧭 Services list:"
for i in "${!SERVICE_NAMES[@]}"; do
  echo "  • (enabled)  ${SERVICE_NAMES[$i]} → ${SERVICE_PATHS[$i]} :: ${SERVICE_CMDS[$i]}  [ENV_FILE=$(basename "${SERVICE_ENVFILES[$i]}")]"
done

mkdir -p "$ROOT/var/log"
PIDS=()
echo "🚀 Starting services..."
for i in "${!SERVICE_NAMES[@]}"; do
  name="${SERVICE_NAMES[$i]}"
  path="${SERVICE_PATHS[$i]}"
  cmd="${SERVICE_CMDS[$i]}"
  svc_env="${SERVICE_ENVFILES[$i]}"
  SLUG_UPPER="$(echo "$name" | tr '[:lower:]' '[:upper:]')"

    if [[ "$name" == "gateway" ]]; then
    # KMS bits read from the gateway env file (not exporting to parent)
    KMS_PROJECT_ID_GW="$(get_env "$GW_ENV_FILE" KMS_PROJECT_ID || echo "")"
    KMS_LOCATION_ID_GW="$(get_env "$GW_ENV_FILE" KMS_LOCATION_ID || echo "")"
    KMS_KEY_RING_ID_GW="$(get_env "$GW_ENV_FILE" KMS_KEY_RING_ID || echo "")"
    KMS_KEY_ID_GW="$(get_env "$GW_ENV_FILE" KMS_KEY_ID || echo "")"
    KMS_CRYPTO_KEY_GW="$(mk_crypto_key "$KMS_PROJECT_ID_GW" "$KMS_LOCATION_ID_GW" "$KMS_KEY_RING_ID_GW" "$KMS_KEY_ID_GW")"
    KMS_KEY_NAME_GW="${KMS_CRYPTO_KEY_GW:-}"
    KMS_SIGN_KEY_ID_GW="${KMS_KEY_ID_GW:-}"
    KMS_JWKS_KEY_ID_GW="${KMS_KEY_ID_GW:-}"

    echo "→ gateway inline KMS:"
    echo "   parts: proj=${KMS_PROJECT_ID_GW:-<unset>} loc=${KMS_LOCATION_ID_GW:-<unset>} ring=${KMS_KEY_RING_ID_GW:-<unset>} key=${KMS_KEY_ID_GW:-<unset>}"
    echo "   full : ${KMS_CRYPTO_KEY_GW}"
    echo "   ADC  : GOOGLE_APPLICATION_CREDENTIALS=${GOOGLE_APPLICATION_CREDENTIALS}"
    echo "   SVCCONFIG_BASE_URL (effective): $(get_env "$svc_env" SVCCONFIG_BASE_URL || echo "<unset>")"

    bash -lc "
      set -Eeuo pipefail
      cd \"$path\"

      # Fresh env load, then map PORT → GATEWAY_PORT if present
      unset PORT SERVICE_PORT
      set -a; [ -f \"$svc_env\" ] && . \"$svc_env\"; set +a
      if [ -n \"\$PORT\" ]; then export GATEWAY_PORT=\"\$PORT\" SERVICE_PORT=\"\$PORT\"; fi

      # Export runtime envs
      export NODE_ENV=\"$NODE_ENV\"
      export ENV_FILE=\"$svc_env\" GATEWAY_ENV=\"$svc_env\"
      export GOOGLE_APPLICATION_CREDENTIALS=\"$GOOGLE_APPLICATION_CREDENTIALS\"
      export KMS_PROJECT_ID=\"$KMS_PROJECT_ID_GW\"
      export KMS_LOCATION_ID=\"$KMS_LOCATION_ID_GW\"
      export KMS_KEY_RING_ID=\"$KMS_KEY_RING_ID_GW\"
      export KMS_KEY_ID=\"$KMS_KEY_ID_GW\"
      export KMS_CRYPTO_KEY=\"$KMS_CRYPTO_KEY_GW\"
      export KMS_KEY_NAME=\"$KMS_KEY_NAME_GW\"
      export KMS_SIGN_KEY_ID=\"$KMS_SIGN_KEY_ID_GW\"
      export KMS_JWKS_KEY_ID=\"$KMS_JWKS_KEY_ID_GW\"
      export SVCCONFIG_BASE_URL=\"\${SVCCONFIG_BASE_URL:-}\"
      export ACCESS_RULES_ENABLED=\"\${ACCESS_RULES_ENABLED:-}\"
      export ACCESS_FAIL_OPEN=\"\${ACCESS_FAIL_OPEN:-}\"

      echo '──────────────────────────────── Gateway start context ────────────────────────────────'
      echo \"SERVICE_DIR=\$PWD\"
      echo \"GATEWAY_PORT=\${GATEWAY_PORT:-<unset>}  NODE_ENV=\$NODE_ENV\"
      echo \"SVCCONFIG_BASE_URL=\${SVCCONFIG_BASE_URL:-<unset>}  ENV_FILE=\$ENV_FILE\"
      echo \"KMS_KEY_NAME=\${KMS_KEY_NAME:-<unset>}\"
      echo '──────────────────────────────────────────────────────────────────────────────────────'

      # Pick start command by actually checking package.json for a dev script
      if node -e \"try{p=require('./package.json').scripts?.dev;process.exit(p?0:1)}catch(e){process.exit(1)}\"; then
        echo '→ starting: pnpm dev'
        pnpm dev
      elif [ -f src/app.ts ]; then
        echo '→ starting: ts-node-dev src/app.ts'
        pnpm -s exec ts-node-dev --respawn --transpile-only src/app.ts
      else
        echo '❌ gateway: no dev script and no src/app.ts'
        exit 1
      fi
    " 2>&1 | tee -a "$ROOT/var/log/gateway.dev.log" & PIDS+=($!)

  elif [[ "$name" == "svcconfig" ]]; then
    bash -lc "cd \"$path\" && \
      unset PORT SERVICE_PORT; \
      set -a; [ -f \"$svc_env\" ] && . \"$svc_env\"; set +a; \
      if [ -n \"\$PORT\" ]; then export ${SLUG_UPPER}_PORT=\"\$PORT\" SERVICE_PORT=\"\$PORT\"; fi; \
      NODE_ENV=\"$NODE_ENV\" \
      ENV_FILE=\"$svc_env\" GATEWAY_ENV=\"$svc_env\" \
      MONGO_URI=\"mongodb://127.0.0.1:27017/eff_svcconfig_db\" \
      $cmd" & PIDS+=($!)

  else
    bash -lc "cd \"$path\" && \
      unset PORT SERVICE_PORT; \
      set -a; [ -f \"$svc_env\" ] && . \"$svc_env\"; set +a; \
      if [ -n \"\$PORT\" ]; then export ${SLUG_UPPER}_PORT=\"\$PORT\" SERVICE_PORT=\"\$PORT\"; fi; \
      NODE_ENV=\"$NODE_ENV\" \
      ENV_FILE=\"$svc_env\" GATEWAY_ENV=\"$svc_env\" \
      $cmd" & PIDS+=($!)
  fi
done

echo "📜 PIDs: ${PIDS[*]}"
echo "🟢 All services launched. Ctrl-C to stop."

cleanup() {
  echo "🧹 Cleaning up..."
  if [[ -n "${PIDS[*]:-}" ]]; then
    echo "🧯 Stopping services: ${PIDS[*]}"; kill "${PIDS[@]}" >/dev/null 2>&1 || true
  fi
}
trap 'echo "🛑 Caught signal"; cleanup; exit 0' INT TERM
trap 'echo "💥 Error on line $LINENO"; cleanup; exit 1' ERR

wait
