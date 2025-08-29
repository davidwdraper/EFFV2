// backend/services/template/index.ts
import "./src/bootstrap";
import "./src/log.init"; // if you add one mirroring Act’s
import "tsconfig-paths/register";
import app from "./src/app";
import { config, SERVICE_NAME } from "./src/config";
import { connectDb } from "./src/db"; // provide a template db.ts if desired
import { logger } from "../shared/utils/logger";
import { startHttpService } from "../shared/bootstrap/startHttpService";

process.env.SERVICE_NAME =
  process.env.TEMPLATE_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  "No Service Name Defined";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[template] Unhandled Promise Rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "[template] Uncaught Exception");
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
    logger.error({ err }, "failed to start Template service");
    process.exit(1);
  }
}

start();
