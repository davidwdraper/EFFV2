// backend/services/user/index.ts
import "./src/bootstrap"; // loads ENV_FILE + sets SERVICE_NAME
import "@shared/types/express"; // <-- include Express request augmentation
import "./src/log.init";
import "tsconfig-paths/register";

import app from "./src/app";
import { config } from "./src/config";
import { SERVICE_NAME } from "./src/bootstrap";
import { connectDb } from "./src/db";
import { logger } from "@shared/utils/logger";
import { startHttpService } from "@shared/bootstrap/startHttpService";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[user] Unhandled Promise Rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "[user] Uncaught Exception");
});

async function start() {
  try {
    await connectDb();

    startHttpService({
      app,
      port: config.port, // supports PORT=0 in tests
      serviceName: SERVICE_NAME,
      logger,
    });
  } catch (err) {
    logger.error({ err }, "failed to start User service");
    process.exit(1);
  }
}

start();
