// backend/services/user/index.ts
import "./src/bootstrap"; // load env BEFORE anything that imports logger
import { connectDB } from "./src/db";
import app from "./src/app";
import { config } from "./src/config";
import { logger } from "../shared/utils/logger";

async function main() {
  try {
    await connectDB();
  } catch (err: any) {
    logger.error(
      { err: err?.message || err },
      "[UserService] DB connection failed"
    );
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    logger.info(
      { service: config.serviceName, port: config.port },
      "[UserService] listening"
    );
  });

  process.on("SIGTERM", () => {
    logger.info("[UserService] SIGTERM");
    server.close(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    logger.info("[UserService] SIGINT");
    server.close(() => process.exit(0));
  });
}

void main();
