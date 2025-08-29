// backend/services/geo/index.ts
import "./src/bootstrap";
import "./src/log.init";
import "tsconfig-paths/register";
import app from "./src/app";
import { config, SERVICE_NAME } from "./src/config";
import { logger } from "../shared/utils/logger";
import { startHttpService } from "../shared/bootstrap/startHttpService";

// No DB for geo (proxy service)

process.env.SERVICE_NAME =
  process.env.GEO_SERVICE_NAME ||
  process.env.SERVICE_NAME ||
  "No Service Name Defined";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[geo] Unhandled Promise Rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "[geo] Uncaught Exception");
});

(async function start() {
  try {
    startHttpService({
      app,
      port: config.port,
      serviceName: SERVICE_NAME,
      logger,
    });
  } catch (err) {
    logger.error({ err }, "failed to start Geo service");
    process.exit(1);
  }
})();
