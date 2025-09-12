// backend/services/gateway/src/bootstrap.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR: docs/adr/0017-environment-loading-and-validation.md
 *
 * Why:
 * - Load the correct env file (ENV_FILE or .env.dev) from repo root.
 * - Assert only gateway-critical envs here; others validate at point of use.
 */

import path from "path";
import { loadEnvFileOrDie, assertRequiredEnv } from "@eff/shared/env";

const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";

const resolved = path.resolve(__dirname, "../../../..", envFile);
console.log(`[bootstrap] Loading env from: ${resolved}`);
loadEnvFileOrDie();

assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "GATEWAY_PORT",
  // other envs validated at use-sites
]);
