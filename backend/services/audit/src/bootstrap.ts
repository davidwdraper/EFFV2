// backend/services/audit/src/bootstrap.ts
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { pino } from "pino";

// ── Service identity ─────────────────────────────────────────────────────────
export const SERVICE_NAME = "audit" as const;

const log = pino({ level: process.env.LOG_LEVEL || "info" });

function loadEnvFile(filePath: string, label: string) {
  if (!fs.existsSync(filePath)) return false;
  const res = dotenv.config({ path: filePath });
  if (res.error) throw res.error;
  log.info(`[bootstrap] Loaded ${label}: ${filePath}`);
  return true;
}

function resolvePaths() {
  // We expect to run from the service folder (recommended),
  // but make this tolerant regardless of CWD.
  const serviceDir = path.resolve(__dirname, ".."); // .../backend/services/audit/src -> /audit
  const svcRoot = path.resolve(serviceDir, ".."); // .../backend/services/audit
  const backendDir = path.resolve(svcRoot, ".."); // .../backend/services
  const repoRoot = path.resolve(backendDir, ".."); // .../eff

  // If ENV_FILE is absolute, we load ONLY that one (explicit override).
  const envFileArg = process.env.ENV_FILE;
  const envFile =
    envFileArg && path.isAbsolute(envFileArg)
      ? envFileArg
      : envFileArg
      ? path.resolve(process.cwd(), envFileArg)
      : path.join(svcRoot, ".env.dev"); // default to service .env.dev

  return {
    repoEnv: path.join(repoRoot, ".env.dev"), // common/root env
    svcEnv: envFile, // explicit or service-local env
  };
}

function assertRequiredEnv(keys: string[]) {
  const missing = keys.filter(
    (k) => !process.env[k] || String(process.env[k]).trim() === ""
  );
  if (missing.length)
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

(function bootstrap() {
  const { repoEnv, svcEnv } = resolvePaths();

  // 1) Load root (common) first — optional; ignore if missing
  loadEnvFile(repoEnv, "root env");

  // 2) Load service env second — required
  const svcLoaded = loadEnvFile(svcEnv, "service env");
  if (!svcLoaded) {
    throw new Error(`[bootstrap] ENV_FILE not found: ${svcEnv}`);
  }

  // ✅ Audit-only required keys (no ACT_* here)
  assertRequiredEnv([
    "LOG_LEVEL",
    "LOG_SERVICE_URL",
    "AUDIT_PORT",
    "AUDIT_MONGO_URI",
    "S2S_JWT_SECRET",
    "S2S_JWT_ISSUER",
    "S2S_JWT_AUDIENCE",
    "S2S_ALLOWED_ISSUERS",
  ]);
})();
