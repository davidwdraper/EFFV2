// backend/services/act/index.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Boot: docs/architecture/backend/BOOTSTRAP.md
 * - ADRs:
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *   - docs/adr/0027-entity-services-on-shared-createServiceApp.md
 *
 * Why:
 * - Keep start-up boring and reliable: load env (bootstrap), init logs, connect DB,
 *   then start HTTP with shared startHttpService.
 */

import "./src/bootstrap"; // loads env + sets SERVICE_NAME
import "./src/log.init";
import "tsconfig-paths/register";

import app from "./src/app";
import { config } from "./src/config";
import { SERVICE_NAME } from "./src/bootstrap";
import { connectDb } from "./src/db";
import { logger } from "@eff/shared/src/utils/logger";
import { startHttpService } from "@eff/shared/src/bootstrap/startHttpService";

// Top-level guards
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, `[${SERVICE_NAME}] Unhandled Promise Rejection`);
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, `[${SERVICE_NAME}] Uncaught Exception`);
});

async function start() {
  try {
    await connectDb();
    startHttpService({
      app,
      port: config.port,
      serviceName: SERVICE_NAME,
      logger,
    });
  } catch (err) {
    logger.error({ err }, `failed to start ${SERVICE_NAME} service`);
    process.exit(1);
  }
}

start();
