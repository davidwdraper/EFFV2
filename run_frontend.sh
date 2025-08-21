#!/usr/bin/env bash
# run_frontend.sh
# Startup script for NowVibin Flutter frontend

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

cd "$FRONTEND_DIR"

echo "[frontend] Running flutter pub get..."
flutter pub get

# Load env file (defaults to .env.dev at repo root)
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.dev}"
echo "[frontend] Using env file: $ENV_FILE"
export $(grep -v '^#' "$ENV_FILE" | xargs)

# Run Flutter app (choose device: web-server or iOS/Android)
echo "[frontend] Starting Flutter app on web..."
flutter run -d web-server --web-hostname=localhost --web-port=3000
