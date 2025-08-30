// backend/services/gateway/index.ts

import "./src/bootstrap"; // loads ENV_FILE (defaults to .env.dev) + asserts required envs
import "./src/log.init";
import { app } from "./src/app";
import { PORT, SERVICE_NAME } from "./src/config";
import { logger } from "../shared/utils/logger";

const NODE_ENV = process.env.NODE_ENV || "dev";
// Bind policy: explicit env wins; otherwise loopback in non-prod, 0.0.0.0 in prod.
const BIND_ADDR =
  process.env.GATEWAY_BIND_ADDR ||
  (NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const FORCE_HTTPS = process.env.FORCE_HTTPS === "true";

async function start() {
  try {
    const server = app.listen(PORT, BIND_ADDR, () => {
      logger.info(
        { port: PORT, bind: BIND_ADDR, env: NODE_ENV, forceHttps: FORCE_HTTPS },
        `[${SERVICE_NAME}] listening`
      );
    });

    // Optional: keep-alive + header timeouts (small DoS hardening at the socket layer)
    // @ts-ignore Node types may vary by version
    server.keepAliveTimeout = 7000; // ms
    // @ts-ignore
    server.headersTimeout = 9000; // must be > keepAliveTimeout

    // Graceful shutdown
    const shutdown = (signal: string) => {
      logger.info({ signal }, `[${SERVICE_NAME}] shutting down…`);
      server.close(() => process.exit(0));
      // Force-exit if not closed in time
      setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    server.on("error", (err: any) => {
      logger.error({ err }, `[${SERVICE_NAME}] server error`);
      process.exit(1);
    });

    // Catch unhandleds (don’t let the process limp along)
    process.on("unhandledRejection", (reason: any) => {
      logger.error({ reason }, `[${SERVICE_NAME}] unhandledRejection`);
      process.exit(1);
    });
    process.on("uncaughtException", (err: any) => {
      logger.error({ err }, `[${SERVICE_NAME}] uncaughtException`);
      process.exit(1);
    });
  } catch (err) {
    logger.error({ err }, `[${SERVICE_NAME}] failed to start`);
    process.exit(1);
  }
}

start();
