// backend/services/user/index.ts
import "./src/bootstrap"; // ENV_FILE + USER_* validated before anything else
import app from "./src/app";
import { config } from "./src/config";
import { connectDb } from "./src/db";
import { logger } from "../shared/utils/logger";
import { startHttpService } from "../shared/bootstrap/startHttpService";

async function start() {
  try {
    // If your connectDb needs a URI, switch to: await connectDb(config.mongoUri);
    await connectDb();

    startHttpService({
      app,
      port: config.port, // supports PORT=0 in tests
      serviceName: config.serviceName, // e.g., USER_SERVICE_NAME
      logger,
    });
  } catch (err) {
    logger.error({ err }, "failed to start User service");
    process.exit(1);
  }
}

start();
