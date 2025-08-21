#!/usr/bin/env bash
# run_frontend.sh — Force-launch NowVibin Flutter web on Chrome

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

cd "$FRONTEND_DIR"

echo "[frontend] flutter pub get"
flutter pub get

# Ensure web is enabled
flutter config --enable-web >/dev/null 2>&1 || true

# macOS default Chrome path (adjust if you use Chromium or Canary)
export CHROME_EXECUTABLE="${CHROME_EXECUTABLE:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

# Sanity check: fall back to common alternatives if the default isn’t present
if [[ ! -x "$CHROME_EXECUTABLE" ]]; then
  for CANDIDATE in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  do
    if [[ -x "$CANDIDATE" ]]; then
      export CHROME_EXECUTABLE="$CANDIDATE"
      break
    fi
  done
fi

echo "[frontend] Using CHROME_EXECUTABLE: ${CHROME_EXECUTABLE:-<not found>}"

# If Chrome still isn't detected by Flutter, this helps it find the device
flutter doctor -v >/dev/null 2>&1 || true

# Force Chrome device (opens a window). Change PORT if you want.
PORT="${PORT:-3000}"
flutter run -d chrome --web-hostname=localhost --web-port="$PORT"
