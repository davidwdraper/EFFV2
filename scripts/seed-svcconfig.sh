# scripts/seed-svcconfig.sh
#!/usr/bin/env bash
set -Eeuo pipefail

#───────────────────────────────────────────────────────────────────────────────
# Seeds svcconfig and routePolicies from backend/services/svcconfig/seed.ts
# Reads key values from .env.dev at repo root.
# Uses pnpm instead of yarn (no legacy package managers).
#───────────────────────────────────────────────────────────────────────────────

LOG_LEVEL=debug \
LOG_SERVICE_URL="$(grep -E '^LOG_SERVICE_URL=' .env.dev | cut -d= -f2-)" \
LOG_SERVICE_TOKEN_CURRENT="$(grep -E '^LOG_SERVICE_TOKEN_CURRENT=' .env.dev | cut -d= -f2-)" \
LOG_SERVICE_TOKEN_NEXT="$(grep -E '^LOG_SERVICE_TOKEN_NEXT=' .env.dev | cut -d= -f2-)" \
LOG_CLIENT_DISABLE_FS=true \
ENV_FILE=backend/services/svcconfig/.env.dev \
pnpm --filter @eff/svcconfig run seed
