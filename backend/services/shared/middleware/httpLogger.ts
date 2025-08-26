// backend/services/shared/middleware/httpLogger.ts
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { logger } from "../utils/logger";

export function makeHttpLogger(serviceName: string) {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const hdr =
        (req.headers["x-request-id"] as string | undefined) ||
        (req.headers["x-correlation-id"] as string | undefined) ||
        (req.headers["x-amzn-trace-id"] as string | undefined);
      const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();
      res.setHeader("x-request-id", id);
      return String(id);
    },
    customLogLevel: (
      _req: IncomingMessage,
      res: ServerResponse,
      err?: Error
    ) => {
      if (err) return "error";
      const s = res.statusCode;
      if (s >= 500) return "error";
      if (s >= 400) return "warn";
      return "info";
    },
    customProps: (req: IncomingMessage) => {
      const r = req as any;
      const userId = r?.user?.userId || r?.auth?.userId;
      return { service: serviceName, route: r?.route?.path, userId };
    },
    autoLogging: {
      ignore: (req: IncomingMessage) => {
        const url = (req as any).url as string | undefined;
        return (
          url === "/health" ||
          url === "/healthz" ||
          url === "/readyz" ||
          url === "/favicon.ico"
        );
      },
    },
    serializers: {
      req(req: IncomingMessage) {
        const r = req as any;
        return { id: r.id, method: r.method, url: r.url };
      },
      res(res: ServerResponse) {
        return { statusCode: res.statusCode };
      },
    },
  });
}
