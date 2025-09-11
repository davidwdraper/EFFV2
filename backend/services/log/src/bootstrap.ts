// backend/services/log/src/bootstrap.ts
import path from "path";
import {
  loadServiceAndRootEnvOrThrow,
  assertRequiredEnv,
} from "@shared/src/env";

// ── Service identity ─────────────────────────────────────────────────────────
export const SERVICE_NAME = "log" as const;

// Root first, then service overrides
const rootEnv = path.resolve(__dirname, "../../../..", ".env.dev"); // /eff/.env.dev
const svcEnv = path.resolve(__dirname, "..", ".env.dev"); // /eff/backend/services/log/.env.dev  ✅

console.log(
  `[bootstrap] [log] Loading env from (root→svc): ${rootEnv} , ${svcEnv}`
);
loadServiceAndRootEnvOrThrow(svcEnv, rootEnv);

assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_MONGO_URI",
  "LOG_PORT",
  "LOG_SERVICE_TOKEN_CURRENT",
]);
