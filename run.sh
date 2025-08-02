#!/bin/bash

cd "$(dirname "$0")"

# ✅ Trap Ctrl-C and only kill this process group
trap 'echo "🛑 Caught Ctrl-C. Cleaning up..."; kill 0; exit 0' INT

MODE=$1

SERVICES=(
  log
  user
  act
  event
  place
  auth
  eventact
  eventplace
  useract
  orchestrator
  orchestrator-core
  image
)

if [ "$MODE" == "docker" ]; then
  echo "🛳️  Starting in DOCKER mode..."
  docker-compose --env-file .env.docker up --build

elif [ "$MODE" == "dev" ]; then
  echo "🧹 Killing any processes using service ports from .env.dev..."
  grep _PORT .env.dev | cut -d '=' -f2 | xargs -I {} lsof -ti :{} | xargs kill -9 2>/dev/null

  echo "💻 Starting available services with concurrently..."

  COMMANDS=()
  NAMES=()

  for service in "${SERVICES[@]}"; do
    path="backend/services/$service"

    if [ -d "$path" ]; then
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

else
  echo "❌ Invalid mode. Usage: ./run.sh [dev|docker]"
  exit 1
fi
