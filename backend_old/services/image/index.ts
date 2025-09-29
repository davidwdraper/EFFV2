// backend/services/image/index.ts
import "./src/bootstrap"; // ✅ load env BEFORE anything that imports logger
import app from "./src/app";
import { connectDB } from "./src/db";
import { config } from "./src/config";
import { logger } from "@shared/utils/logger";

async function start() {
  try {
    await connectDB();
  } catch (err: any) {
    logger.error(
      { err: err?.message || err },
      "[ImageService] DB connection failed"
    );
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    logger.info(
      { service: config.serviceName, port: config.port },
      "[ImageService] listening"
    );
  });

  process.on("SIGTERM", () => {
    logger.info("[ImageService] SIGTERM");
    server.close(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    logger.info("[ImageService] SIGINT");
    server.close(() => process.exit(0));
  });
}

void start();
