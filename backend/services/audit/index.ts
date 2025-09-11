// backend/services/audit/index.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - Design: docs/design/backend/audit/OVERVIEW.md
 * - Boot: docs/architecture/backend/BOOTSTRAP.md
 *
 * Why:
 * - Keep entrypoint boring and reliable:
 *   1) Load env (via ./src/bootstrap which uses @shared/env).
 *   2) Connect DB so WAL replay has a live target.
 *   3) Replay WAL before accepting traffic (durability catch-up).
 *   4) Start HTTP server with shared helper (structured logs).
 *   5) Handle signals here (graceful shutdown) — avoids coupling to startHttpService types.
 */

import "./src/bootstrap/bootstrap"; // loads env in standard order + asserts required vars
import "./src/log.init"; // pino sinks / bindings
import "tsconfig-paths/register";

import app from "./src/app";
import { config } from "./src/config";
import { SERVICE_NAME } from "./src/bootstrap/bootstrap";
import { connectDb, disconnectDb } from "./src/db";
import { logger } from "@shared/utils/logger";
import { startHttpService } from "@shared/src/bootstrap/startHttpService";
import { preflightWALReplay } from "./src/bootstrap/walbootstrap";

// ---- Top-level process guards ----------------------------------------------
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, `[${SERVICE_NAME}] Unhandled Promise Rejection`);
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, `[${SERVICE_NAME}] Uncaught Exception`);
});

async function start() {
  try {
    // 1) DB first — needed for WAL replay upserts
    await connectDb();

    // 2) Durability catch-up before we accept live traffic
    await preflightWALReplay();

    // 3) Start HTTP server
    const server: any = startHttpService({
      app,
      port: config.port,
      serviceName: SERVICE_NAME,
      logger,
    });

    // 4) Graceful shutdown (signals) — do not depend on startHttpService options
    const shutdown = async (signal: NodeJS.Signals) => {
      logger.info({ signal }, `[${SERVICE_NAME}] shutdown requested`);
      try {
        // Close HTTP listener if possible (best-effort)
        if (server && typeof server.close === "function") {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      } catch (err) {
        logger.warn({ err }, `[${SERVICE_NAME}] server.close failed`);
      }
      try {
        await disconnectDb();
      } catch (err) {
        logger.warn({ err }, `[${SERVICE_NAME}] disconnectDb failed`);
      } finally {
        process.exit(0);
      }
    };

    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
  } catch (err) {
    logger.error({ err }, `failed to start ${SERVICE_NAME} service`);
    // Fail fast so container/orchestrator can restart us
    process.exit(1);
  }
}

start();
