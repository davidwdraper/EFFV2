// backend/services/log/index.ts
import "./src/bootstrap";
import app from "./src/app";
import { logger } from "@shared/utils/logger";
import { config } from "./src/config";
import { SERVICE_NAME } from "./src/bootstrap";

const server = app.listen(config.port, () => {
  logger.info(
    { service: SERVICE_NAME, port: config.port },
    `${SERVICE_NAME} listening`
  );
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  server.close(() => process.exit(0));
});
