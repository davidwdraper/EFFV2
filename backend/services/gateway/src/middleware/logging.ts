// backend/services/gateway/src/middleware/logging.ts
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { logger } from "../../../shared/utils/logger";
import { serviceName } from "../config";
import { sanitizeUrl } from "../utils/sanitizeUrl";

export function loggingMiddleware() {
  return pinoHttp({
    logger,
    customLogLevel(_req, res, err) {
      if (err) return "error";
      const s = res.statusCode;
      if (s >= 500) return "error";
      if (s >= 400) return "warn";
      return "info";
    },
    genReqId: (req, res) => {
      const hdr =
        req.headers["x-request-id"] ||
        req.headers["x-correlation-id"] ||
        req.headers["x-amzn-trace-id"];
      const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();
      res.setHeader("x-request-id", String(id));
      return String(id);
    },
    customProps(req) {
      return { service: serviceName, reqId: (req as any).id };
    },
    autoLogging: {
      ignore: (req) =>
        req.url === "/health" ||
        req.url === "/healthz" ||
        req.url === "/readyz" ||
        req.url === "/favicon.ico",
    },
    serializers: {
      req(req) {
        return {
          id: (req as any).id,
          method: req.method,
          url: sanitizeUrl(req.url),
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
    redact: { paths: [], remove: true },
  });
}
