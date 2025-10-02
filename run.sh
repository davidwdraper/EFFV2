#!/usr/bin/env bash
# =============================================================================
# NowVibin Dev Runner (prod-parity-ish)
# macOS Bash 3.2 compatible (no assoc arrays, no process substitution)
# =============================================================================

set -Eeuo pipefail
export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/nowvibin/gateway-dev.json}"
ENV_FILE=.env.dev

export TMPDIR="$HOME/.tmp"
mkdir -p "$TMPDIR"

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

# ======= Service list (current reality) =====================================
# Keep this tight; uncomment/add as services come online.
SERVICES=(
  #"svcfacilitator|backend/services/svcfacilitator|pnpm dev"
  #"gateway|backend/services/gateway|pnpm dev"
  #"auth|backend/services/auth|pnpm dev"
  "user|backend/services/user|pnpm dev"
  # "audit|backend/services/audit|pnpm dev"
)

# ======= Helpers =============================================================
get_env() { local file="$1" key="$2"; [[ -f "$file" ]] || return 1; grep -E "^${key}=" "$file" | tail -n1 | cut -d'=' -f2- || true; }
has_cmd() { command -v "$1" >/dev/null 2>&1; }
trim() { echo "$1" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'; }
mk_crypto_key() { local proj="$1" loc="$2" ring="$3" key="$4"; echo "projects/${proj}/locations/${loc}/keyRings/${ring}/cryptoKeys/${key}"; }

# ======= Gateway env file path (for optional --test KMS export) =============
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
    key="${line%%=*}"; val="${line#*=}"; val="${val%\"}"; val="${val#\"}"
    export "$key"="$val"
  done < "$GW_ENV_FILE"

  KMS_PROJECT_ID="${KMS_PROJECT_ID:-}"; KMS_LOCATION_ID="${KMS_LOCATION_ID:-}"
  KMS_KEY_RING_ID="${KMS_KEY_RING_ID:-}"; KMS_KEY_ID="${KMS_KEY_ID:-}"
  KMS_CRYPTO_KEY="$(mk_crypto_key "$KMS_PROJECT_ID" "$KMS_LOCATION_ID" "$KMS_KEY_RING_ID" "$KMS_KEY_ID")"
  export KMS_CRYPTO_KEY KMS_KEY_NAME="$KMS_CRYPTO_KEY" KMS_SIGN_KEY_ID="$KMS_KEY_ID" KMS_JWKS_KEY_ID="$KMS_KEY_ID"

  if [[ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
    echo "✓ ADC via SA file: $GOOGLE_APPLICATION_CREDENTIALS"
  elif has_cmd gcloud && gcloud auth application-default print-access-token >/dev/null 2>&1; then
    echo "→ ADC: gcloud application-default credentials detected (dev convenience)"
  else
    echo "⚠️  No ADC detected. Set GOOGLE_APPLICATION_CREDENTIALS to your SA JSON for parity."
  fi
fi

# ======= Docker mode =========================================================
if [[ "$MODE" == "docker" ]]; then
  [[ -f "$ENV_FILE" ]] || { echo "❌ ENV_FILE not found: $ENV_FILE"; exit 1; }
  echo "🛳️  Starting docker compose with env file: $ENV_FILE"
  docker compose --env-file "$ENV_FILE" up --build
  exit 0
fi

# ======= Dev mode ============================================================
[[ "$MODE" == "dev" ]] || { echo "❌ Invalid mode. Usage: ENV_FILE=.env.dev ./scripts/run.sh [--test] [dev|docker]"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "❌ ENV_FILE not found: $ENV_FILE"; exit 1; }

# ---- Parity guard: require ADC via SA file in all environments --------------
if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" || ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]]; then
  echo "❌ GOOGLE_APPLICATION_CREDENTIALS not set or file missing."
  echo "   Example: export GOOGLE_APPLICATION_CREDENTIALS=\"\$HOME/.config/nowvibin/gateway-dev.json\""
  exit 1
fi
echo "✓ ADC via SA file: $GOOGLE_APPLICATION_CREDENTIALS"

ROOT_ENV="$ROOT/.env.dev"
if [[ -f "$ROOT_ENV" ]]; then
  echo "📦 Loading root globals from: $ROOT_ENV"
  export NODE_ENV="$(get_env "$ROOT_ENV" NODE_ENV || echo dev)"
  export LOG_LEVEL="$(get_env "$ROOT_ENV" LOG_LEVEL || echo debug)"
else
  echo "ℹ️  Root .env.dev not found; using built-in defaults."
  export NODE_ENV="${NODE_ENV:-dev}"
  export LOG_LEVEL="${LOG_LEVEL:-debug}"
fi
echo "🔧 NODE_ENV=${NODE_ENV}  LOG_LEVEL=${LOG_LEVEL}"

# ======= Build @nv/shared (per-package build, no root typescript needed) =====
SHARED_DIR="$ROOT/backend/services/shared"
echo "🛠️  Building @nv/shared (package build)…"
if [[ -d "$SHARED_DIR" ]]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm --dir "$SHARED_DIR" run build || { echo "❌ @nv/shared build failed"; exit 1; }
  else
    npm --prefix "$SHARED_DIR" run build || { echo "❌ @nv/shared build failed"; exit 1; }
  fi
  [[ -f "$SHARED_DIR/dist/index.js" ]] || { echo "❌ @nv/shared did not emit dist/index.js"; exit 1; }
  echo "✅ @nv/shared built."
else
  echo "❌ Shared package not found at $SHARED_DIR"; exit 1
fi

# ======= Optional: sync ports step (only if script exists) ===================
if [[ -f "$ROOT/scripts/sync/sync_ports_from_svcconfig.cjs" ]]; then
  echo "🔧 Syncing service ports from svcconfig → .env.dev (PORT=…)…"
  node "$ROOT/scripts/sync/sync_ports_from_svcconfig.cjs" || echo "⚠️  port sync script failed or not applicable"
  echo "✅ Ports sync step complete"
else
  echo "ℹ️  No svcconfig port sync script found; skipping."
fi

# ======= Resolve service env files ==========================================
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

  LOG_FILE="$ROOT/var/log/${name}.dev.log"

  bash -lc "
    set -Eeuo pipefail
    cd \"$path\"

    # load env file
    unset PORT SERVICE_PORT
    set -a; [ -f \"$svc_env\" ] && . \"$svc_env\"; set +a

    if [ -n \"\${PORT:-}\" ]; then export ${SLUG_UPPER}_PORT=\"\$PORT\" SERVICE_PORT=\"\$PORT\"; fi

    # baseline runtime envs
    export NODE_ENV=\"$NODE_ENV\"
    export ENV_FILE=\"$svc_env\"
    export GOOGLE_APPLICATION_CREDENTIALS=\"$GOOGLE_APPLICATION_CREDENTIALS\"

    echo '─────────────────────────────── Service start context ───────────────────────────────'
    echo \"SERVICE_DIR=\$PWD\"
    echo \"NAME=$name  SERVICE_PORT=\${SERVICE_PORT:-<unset>}  NODE_ENV=\$NODE_ENV\"
    echo \"ENV_FILE=\$ENV_FILE\"
    echo '────────────────────────────────────────────────────────────────────────────────────'

    # Prefer package script; fall back to dev entry if present
    if node -e \"try{p=require('./package.json').scripts?.dev;process.exit(p?0:1)}catch(e){process.exit(1)}\"; then
      echo '→ starting: pnpm dev'
      pnpm dev
    elif [ -f \"src/index.ts\" ]; then
      echo '→ starting: tsx watch src/index.ts'
      pnpm -s exec tsx watch src/index.ts
    else
      echo '❌ $name: no dev script and no src/index.ts'
      exit 1
    fi
  " 2>&1 | tee -a "$LOG_FILE" & PIDS+=($!)

  # ---- Minimal race fix: if we just launched svcfacilitator, pause 5s -------
  if [[ "$name" = "svcfacilitator" ]]; then
    echo "⏳ svcfacilitator started; waiting 5s to warm up…"
    sleep 5
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
