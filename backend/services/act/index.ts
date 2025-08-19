// backend/services/act/index.ts
import "./src/bootstrap"; // Load ENV_FILE + validate ACT_* before anything else
import app from "./src/app";
import { config } from "./src/config";
import { connectDB } from "./src/db";
import { logger } from "../shared/utils/logger";

console.log("[Act index.ts] CWD:", process.cwd());

async function start() {
  try {
    await connectDB();

    const server = app.listen(config.port, () => {
      logger.info(
        { service: process.env.ACT_SERVICE_NAME, port: config.port },
        `Act service listening on port ${config.port}`
      );
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      logger.info("SIGTERM received. Shutting down Act service...");
      server.close(() => process.exit(0));
    });

    process.on("SIGINT", () => {
      logger.info("SIGINT received. Shutting down Act service...");
      server.close(() => process.exit(0));
    });
  } catch (err) {
    logger.error({ err }, "Failed to start Act service");
    process.exit(1);
  }
}

start();
