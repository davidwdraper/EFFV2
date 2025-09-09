// backend/services/audit/index.ts
import "./src/bootstrap/bootstrap"; // loads env + sets SERVICE_NAME
import "./src/log.init";
import "tsconfig-paths/register";

import app from "./src/app";
import { config } from "./src/config";
import { SERVICE_NAME } from "./src/bootstrap/bootstrap";
import { connectDb } from "./src/db";
import { logger } from "@shared/utils/logger";
import { startHttpService } from "@shared/bootstrap/startHttpService";
import { preflightWALReplay } from "./src/bootstrap/walbootstrap";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, `[${SERVICE_NAME}] Unhandled Promise Rejection`);
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, `[${SERVICE_NAME}] Uncaught Exception`);
});

async function start() {
  try {
    // 1) Connect DB first (needed for replay upserts)
    await connectDb();

    // 2) Replay WAL BEFORE accepting HTTP to avoid competing with live traffic
    await preflightWALReplay();

    // 3) Start HTTP service
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
