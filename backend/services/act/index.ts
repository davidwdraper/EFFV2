// backend/services/act/index.ts
import "./src/bootstrap"; // ENV_FILE + ACT_* validated before anything else
import app from "./src/app";
import { config } from "./src/config";
import { connectDb } from "./src/db";
import { logger } from "../shared/utils/logger";
import { startHttpService } from "../shared/bootstrap/startHttpService";

async function start() {
  try {
    // If your connectDb needs a URI: await connectDb(config.mongoUri);
    await connectDb();

    startHttpService({
      app,
      port: config.port, // supports PORT=0 in tests
      serviceName: String(process.env.ACT_SERVICE_NAME),
      logger,
    });
  } catch (err) {
    logger.error({ err }, "failed to start Act service");
    process.exit(1);
  }
}

start();
