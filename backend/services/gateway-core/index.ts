// backend/services/gateway-core/index.ts
import "./src/bootstrap"; // load ENV_FILE + assert envs first
import "./src/log.init";
import app from "./src/app";
import { PORT, SERVICE_NAME } from "./src/config";
import { logger } from "@eff/shared/src/utils/logger";

async function start() {
  try {
    const server = app.listen(PORT, () => {
      logger.info({ port: PORT }, `[${SERVICE_NAME}] listening`);
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      logger.info(`[${SERVICE_NAME}] SIGTERM received, shutting down…`);
      server.close(() => process.exit(0));
    });
    process.on("SIGINT", () => {
      logger.info(`[${SERVICE_NAME}] SIGINT received, shutting down…`);
      server.close(() => process.exit(0));
    });

    server.on("error", (err) => {
      logger.error({ err }, `[${SERVICE_NAME}] server error`);
      process.exit(1);
    });
  } catch (err) {
    logger.error({ err }, `[${SERVICE_NAME}] failed to start`);
    process.exit(1);
  }
}

start();
