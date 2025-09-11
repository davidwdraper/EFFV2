// backend/services/shared/bootstrap/startHttpService.ts

/**
 * Docs:
 * - Design: docs/design/backend/app/bootstrap.md
 * - Architecture: docs/architecture/backend/MICROSERVICES.md
 *
 * Why:
 * - Starting/stopping an HTTP server should be a **single concern**: bind, log
 *   where it landed (port 0 in tests), and shut down cleanly on signals.
 * - Higher-level bootstraps (env load, logger init, app assembly) call this;
 *   this file never loads envs or mutates global state.
 *
 * Notes:
 * - Uses `process.once` for SIGINT/SIGTERM so multiple calls don’t multiply handlers.
 * - Exposes a `stop()` promise for test harnesses and orderly shutdowns.
 * - On server 'error', we log and exit(1) — bootstrap should be fatal if the port
 *   can’t bind (binding failures aren’t recoverable here).
 */

import type { Express } from "express";
import type { AddressInfo } from "node:net";

type PinoLike = {
  info: (o: any, m?: string) => void;
  error: (o: any, m?: string) => void;
};

export interface StartHttpServiceOptions {
  app: Express;
  /** Allow 0 in tests to get an ephemeral port. */
  port: number;
  /** Service identity for logs (e.g., "act", "user"). */
  serviceName: string;
  /** Pino-like logger (child of shared logger preferred). */
  logger: PinoLike;
}

export interface StartedService {
  server: import("http").Server;
  boundPort: number;
  stop: () => Promise<void>;
}

export function startHttpService(
  opts: StartHttpServiceOptions
): StartedService {
  const { app, port, serviceName, logger } = opts;

  const server = app.listen(port, () => {
    const addr = server.address() as AddressInfo | null;
    const boundPort = addr?.port ?? port;
    logger.info({ service: serviceName, port: boundPort }, "service listening");
  });

  server.on("error", (err) => {
    logger.error({ err, service: serviceName }, "http server error");
    process.exit(1);
  });

  const stop = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

  const shutdown = (signal: string) => {
    logger.info({ signal, service: serviceName }, "shutting down service");
    void stop().then(() => process.exit(0));
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  const addr = server.address() as AddressInfo | null;
  const boundPort = addr?.port ?? port;

  return { server, boundPort, stop };
}
