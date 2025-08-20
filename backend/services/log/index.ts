// backend/services/log/index.ts
import "./src/bootstrap";
import app from "./src/app";
import { logger } from "../shared/utils/logger";
import { config } from "./src/config";

const server = app.listen(config.port, () => {
  logger.info(
    { service: config.serviceName, port: config.port },
    `${config.serviceName} listening`
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
