import "./src/bootstrap";
import "./src/log.init";
import { logger } from "@shared/utils/logger";
import { app } from "./src/app.min";

const PORT = Number(process.env.GATEWAY_PORT || 4000);
const BIND = process.env.GATEWAY_BIND_ADDR || "127.0.0.1";

const server = app.listen(PORT, BIND, () => {
  logger.info({ port: PORT, bind: BIND }, "[gateway:min] listening");
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
