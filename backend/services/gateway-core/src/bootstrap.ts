// backend/services/gateway-core/src/bootstrap.ts
import path from "path";
import { loadEnvFileOrDie, assertRequiredEnv } from "@shared/src/env";

const envFile =
  (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";
const resolved = path.resolve(__dirname, "../../../..", envFile);

console.log(`[bootstrap] Loading env from: ${resolved}`);
loadEnvFileOrDie();

// One-time visibility for S2S plane
console.log(
  "[s2s] iss=%s aud=%s",
  process.env.S2S_JWT_ISSUER,
  process.env.S2S_JWT_AUDIENCE
);

// Keep required envs minimal but correct for core
assertRequiredEnv([
  "LOG_LEVEL",
  "LOG_SERVICE_URL",
  "GATEWAY_CORE_PORT", // core’s listener
  "S2S_JWT_SECRET",
  "S2S_JWT_ISSUER",
  "S2S_JWT_AUDIENCE",
]);
