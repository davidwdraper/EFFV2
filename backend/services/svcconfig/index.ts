// backend/services/svcconfig/index.ts

/**
 * svcconfig entrypoint (root-level).
 * Loads env + logger via shared bootstrap first, then lazy-loads modules
 * that read env (config, db, etc). Keeps index.ts at repo convention.
 *
 * Why:
 * - Use shared bootstrap (loads env cascade, asserts required vars, inits logger).
 * - Keep app/db requires lazy so they only execute after env + logger are ready.
 * - No direct /dist imports; rely on @eff/shared subpaths with tsconfig path mapping in dev.
 */

import { bootstrapService } from "@eff/shared/bootstrap/bootstrapService";

const SERVICE_NAME = "svcconfig";

(async function main() {
  try {
    // 1) Bootstrap: loads env cascade, validates required vars, inits logger
    await bootstrapService({
      serviceName: SERVICE_NAME,
      serviceRootAbs: __dirname,
      // Lazily require the app so its deps only load after env is ready
      createApp: () => require("./src/app").default,
      portEnv: "SVCCONFIG_PORT",
      // Assert DB env up-front (fail fast)
      requiredEnv: ["SVCCONFIG_MONGO_URI"],
    });

    // 2) Logger is safe to use now (load after bootstrap)
    const { logger } = require("@eff/shared/src/utils/logger");

    // 3) Global process error handlers (after logger ready)
    process.on("unhandledRejection", (reason: unknown) => {
      logger.error({ reason }, `[${SERVICE_NAME}] Unhandled Promise Rejection`);
    });
    process.on("uncaughtException", (err: unknown) => {
      logger.error({ err }, `[${SERVICE_NAME}] Uncaught Exception`);
    });

    // 4) Connect DB after env + logger are initialized
    const { connectDb } = require("./src/db");
    await connectDb();
    logger.info({ svc: SERVICE_NAME }, "database connected");
  } catch (err) {
    // Last-ditch console in case logger isn't ready
    // eslint-disable-next-line no-console
    console.error(`[${SERVICE_NAME}] fatal bootstrap error`, err);
    process.exit(1);
  }
})();
