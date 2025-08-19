// backend/services/auth/index.ts
import "./src/bootstrap"; // ✅ load env BEFORE anything that imports logger
import app from "./src/app";
import { config } from "./src/config";
import { logger } from "@shared/utils/logger";

const PORT = config.port; // validated in config.ts

async function start() {
  try {
    const server = app.listen(PORT, () => {
      logger.info(
        { service: "auth", port: PORT },
        "[auth.bootstrap] Service started"
      );
    });

    process.on("SIGTERM", () => {
      logger.info("[auth] SIGTERM");
      server.close(() => process.exit(0));
    });
    process.on("SIGINT", () => {
      logger.info("[auth] SIGINT");
      server.close(() => process.exit(0));
    });
  } catch (err) {
    logger.error({ err }, "[auth.bootstrap] Failed to start service");
    process.exit(1);
  }
}

start();
