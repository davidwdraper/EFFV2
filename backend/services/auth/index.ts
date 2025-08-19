// backend/services/auth/index.ts
import app from "./src/app";
import { config } from "./src/config";
import { logger } from "@shared/utils/logger";

const PORT = config.port; // pulled from config.ts (validated env)

async function start() {
  try {
    app.listen(PORT, () => {
      logger.info(
        { service: "auth", port: PORT },
        "[auth.bootstrap] Service started"
      );
    });
  } catch (err) {
    logger.error({ err }, "[auth.bootstrap] Failed to start service");
    process.exit(1);
  }
}

start();
