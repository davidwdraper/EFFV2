// backend/services/gateway/index.ts

/**
 * Docs:
 * - Design: docs/design/backend/gateway/app.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0022-standardize-shared-import-namespace-to-eff-shared.md
 *
 * Why:
 * - Boot in strict order: env → logger → app; bind per env; fail fast on unhandleds.
 * - Keep server hardening predictable (keepAliveTimeout/headersTimeout).
 */

import "./src/bootstrap"; // loads ENV_FILE + asserts required envs
import "./src/log.init"; // init logger with service name

import { app } from "./src/app";
import { PORT, SERVICE_NAME } from "./src/config";
import { logger } from "@eff/shared/src/utils/logger";

const NODE_ENV = process.env.NODE_ENV || "dev";

// Bind policy: loopback in non-prod unless overridden; 0.0.0.0 in prod.
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

    // Socket hardening
    // @ts-ignore
    server.keepAliveTimeout = 7_000;
    // @ts-ignore
    server.headersTimeout = 9_000;

    const shutdown = (signal: string) => {
      logger.info({ signal }, `[${SERVICE_NAME}] shutting down…`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    server.on("error", (err: unknown) => {
      logger.error({ err }, `[${SERVICE_NAME}] server error`);
      process.exit(1);
    });

    process.on("unhandledRejection", (reason: unknown) => {
      logger.error({ reason }, `[${SERVICE_NAME}] unhandledRejection`);
      process.exit(1);
    });
    process.on("uncaughtException", (err: unknown) => {
      logger.error({ err }, `[${SERVICE_NAME}] uncaughtException`);
      process.exit(1);
    });
  } catch (err) {
    logger.error({ err }, `[${SERVICE_NAME}] failed to start`);
    process.exit(1);
  }
}

start();
