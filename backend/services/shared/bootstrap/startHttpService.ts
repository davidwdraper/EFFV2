// backend/services/shared/bootstrap/startHttpService.ts
import type { Express } from "express";
import type { AddressInfo } from "node:net";

type PinoLike = {
  info: (o: any, m?: string) => void;
  error: (o: any, m?: string) => void;
};

export interface StartHttpServiceOptions {
  app: Express;
  port: number; // allow 0 in tests for ephemeral port
  serviceName: string; // ACT_SERVICE_NAME, USER_SERVICE_NAME, etc.
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
