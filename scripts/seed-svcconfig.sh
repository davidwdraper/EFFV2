# from repo root
LOG_LEVEL=debug \
LOG_SERVICE_URL="$(grep -E '^LOG_SERVICE_URL=' .env.dev | cut -d= -f2-)" \
LOG_SERVICE_TOKEN_CURRENT="$(grep -E '^LOG_SERVICE_TOKEN_CURRENT=' .env.dev | cut -d= -f2-)" \
LOG_SERVICE_TOKEN_NEXT="$(grep -E '^LOG_SERVICE_TOKEN_NEXT=' .env.dev | cut -d= -f2-)" \
LOG_CLIENT_DISABLE_FS=true \
ENV_FILE=backend/services/svcconfig/.env.dev \
yarn --cwd backend/services/svcconfig seed
