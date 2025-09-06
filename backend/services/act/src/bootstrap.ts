// backend/services/act/src/bootstrap.ts

import path from "path";
import { loadEnvFileOrDie, assertRequiredEnv } from "@shared/env";

// ── Service identity ─────────────────────────────────────────────────────────
export const SERVICE_NAME = "act" as const;

// ── ENV file resolution ──────────────────────────────────────────────────────
// Use ENV_FILE if provided, otherwise default to ".env.dev" like geo.
const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";

// Always resolve relative to the monorepo root
const resolved = path.resolve(__dirname, "../../../..", envFile);

console.log(`[bootstrap] Loading env from: ${resolved}`);
loadEnvFileOrDie();

// ── Required envs for this service ───────────────────────────────────────────
assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "ACT_MONGO_URI",
  "ACT_PORT",
]);
