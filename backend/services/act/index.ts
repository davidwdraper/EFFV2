// backend/services/act/index.ts
import "./src/bootstrap"; // ENV_FILE + ACT_* validated before anything else
import "tsconfig-paths/register"; // alias resolver for ts-node runtime
import app from "./src/app";
import { config } from "./src/config";
import { connectDb } from "./src/db";
import { logger } from "../shared/utils/logger";
import { startHttpService } from "../shared/bootstrap/startHttpService";

// Bind service name for the shared logger before it’s imported anywhere.
process.env.SERVICE_NAME =
  process.env.ACT_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  "No Service Name Defined";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[act] Unhandled Promise Rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "[act] Uncaught Exception");
});

async function start() {
  try {
    await connectDb();

    startHttpService({
      app,
      port: config.port, // supports PORT=0 in tests
      serviceName: config.serviceName,
      logger,
    });
  } catch (err) {
    logger.error({ err }, "failed to start Act service");
    process.exit(1);
  }
}

start();
