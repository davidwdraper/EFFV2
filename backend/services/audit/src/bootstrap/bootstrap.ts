// backend/services/audit/src/bootstrap/bootstrap.ts
/**
 * SOP bootstrap for Audit:
 * 1) loadEnvFileOrDie()  — keep parity with other services (NODE_ENV-driven, walk-up single file)
 * 2) Merge repo+service envs (missing ignored, last wins) so root LOG_LEVEL is picked up
 * 3) Optional ENV_FILE override last
 * 4) Assert required vars
 */
import fs from "fs";
import path from "path";
import { pino } from "pino";
import {
  loadEnvFileOrDie,
  loadEnvFilesOrThrow,
  assertRequiredEnv,
} from "@shared/env";

export const SERVICE_NAME = "audit" as const;

(function bootstrap() {
  // This file lives at: backend/services/audit/src/bootstrap/bootstrap.ts
  const serviceRoot = path.resolve(__dirname, "..", ".."); // …/backend/services/audit
  const repoRoot = path.resolve(serviceRoot, "..", "..", ".."); // …/<repo>

  // 1) Keep behavior consistent with the rest of the fleet
  //    (loads the nearest .env[.dev/.docker] based on NODE_ENV)
  loadEnvFileOrDie();

  // 2) Merge repo + service envs (missing ignored; last wins).
  //    Order: repo .env, repo .env.dev, svc .env, svc .env.dev
  const mergeList = [
    path.join(repoRoot, ".env"),
    path.join(repoRoot, ".env.dev"),
    path.join(serviceRoot, ".env"),
    path.join(serviceRoot, ".env.dev"),
  ].filter((f) => fs.existsSync(f));

  if (mergeList.length) {
    loadEnvFilesOrThrow(mergeList, { allowMissing: true, order: "last-wins" });
  }

  // 3) Optional explicit override, loaded LAST
  const envArg = process.env.ENV_FILE;
  if (envArg) {
    const override = path.isAbsolute(envArg)
      ? envArg
      : path.resolve(process.cwd(), envArg);
    loadEnvFilesOrThrow([override], {
      allowMissing: false,
      order: "last-wins",
    });
  }

  // Logger AFTER envs so LOG_LEVEL is honored
  const log = pino({ level: process.env.LOG_LEVEL || "info" });
  log.info(
    {
      merged: mergeList,
      override: process.env.ENV_FILE || null,
    },
    "[bootstrap] env loaded (root+service merged; override last)"
  );

  // 4) Required vars for Audit (names only)
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
