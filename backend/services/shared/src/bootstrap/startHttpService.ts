// backend/services/shared/src/bootstrap/startHttpService.ts

/**
 * Docs:
 * - Design: docs/design/backend/app/bootstrap.md
 * - Architecture: docs/architecture/backend/MICROSERVICES.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0010-5xx-first-assignment-tracing.md
 *
 * Why:
 * - Starting/stopping an HTTP server is a **single concern**: bind, harden
 *   socket timeouts, log where it landed (port 0 in tests), and shut down cleanly.
 * - Higher-level bootstraps (env load, logger init, app assembly) call this;
 *   this file never loads envs or mutates global state beyond signal handlers.
 *
 * Notes:
 * - Uses `process.once` for SIGINT/SIGTERM so multiple calls don’t multiply handlers.
 * - Exposes a `stop()` promise for test harnesses and orderly shutdowns.
 * - Adds keep-alive + header timeout hardening (headersTimeout > keepAliveTimeout).
 * - Avoids `@ts-expect-error`; uses a narrowed type with optional fields instead.
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

// Some Node versions type these; others don’t. Use optional fields to avoid ts-expect-error.
type TunableServer = import("http").Server & {
  keepAliveTimeout?: number;
  headersTimeout?: number;
  requestTimeout?: number;
};

export function startHttpService(
  opts: StartHttpServiceOptions
): StartedService {
  const { app, port, serviceName, logger } = opts;

  const server = app.listen(port, () => {
    const addr = server.address() as AddressInfo | null;
    const boundPort = addr?.port ?? port;
    logger.info({ service: serviceName, port: boundPort }, "service listening");
  });

  // Socket hardening (maintain headersTimeout > keepAliveTimeout)
  const tun = server as TunableServer;
  if (typeof tun.keepAliveTimeout === "number") tun.keepAliveTimeout = 7_000;
  if (typeof tun.headersTimeout === "number") tun.headersTimeout = 9_000;
  // Optional (Node >=18): set a sane request timeout to avoid stuck sockets.
  if (typeof tun.requestTimeout === "number") {
    // leave Node default unless you have a policy; gateway middleware enforces edge timeouts
  }

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
    // Fail-safe in case close hangs
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  const addr = server.address() as AddressInfo | null;
  const boundPort = addr?.port ?? port; // may be 0 until 'listening' fires

  return { server, boundPort, stop };
}
