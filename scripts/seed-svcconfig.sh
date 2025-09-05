# from repo root
set -a; source .env.dev; set +a
ENV_FILE=backend/services/svcconfig/.env.dev \
yarn --cwd backend/services/svcconfig seed
