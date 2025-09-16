// backend/services/user/src/bootstrap.ts
import path from "path";
import { loadEnvFileOrDie, assertRequiredEnv } from "@eff/shared/src/env";

// ── Service identity ─────────────────────────────────────────────────────────
export const SERVICE_NAME = "user" as const;

// ── ENV file resolution ──────────────────────────────────────────────────────
const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";

// Always resolve relative to the monorepo root (for logging only)
const resolved = path.resolve(__dirname, "../../../..", envFile);

console.log(`[bootstrap] Loading env from: ${resolved}`);
loadEnvFileOrDie();

// ── Required envs for this service ───────────────────────────────────────────
assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "USER_MONGO_URI",
  "USER_PORT",
]);
