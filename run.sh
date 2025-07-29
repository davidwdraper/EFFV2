#!/bin/bash

cd "$(dirname "$0")"
trap 'echo "🛑 Caught Ctrl-C. Cleaning up..."; pkill -f ts-node-dev; pkill -f node; exit 1' INT

MODE=$1

SERVICES=(
  user
  act
  event
  place
  log
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

elif [ "$MODE" == "local" ]; then
  echo "🧹 Killing any processes using service ports from .env.local..."
  grep _PORT .env.local | cut -d '=' -f2 | xargs -I {} lsof -ti :{} | xargs kill -9 2>/dev/null

  echo "💻 Starting available services with concurrently..."

  COMMANDS=()
  NAMES=()

  for service in "${SERVICES[@]}"; do
    path="backend/services/$service"
    [ "$service" == "orchestrator" ] && path="backend/orchestrator"
    [ "$service" == "orchestrator-core" ] && path="backend/orchestrator-core"

    if [ -d "$path" ]; then
      COMMANDS+=("cd $path && NODE_ENV=local yarn dev")
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
  echo "❌ Invalid mode. Usage: ./run.sh [local|docker]"
  exit 1
fi
