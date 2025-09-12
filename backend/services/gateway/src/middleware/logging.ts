// backend/services/gateway/src/middleware/logging.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • “Instrumentation everywhere. Pino for structured logs; requestId end-to-end.”
 *   • “Audit vs Security: pino-http is telemetry, Audit WAL is billing, SecurityLog is guardrails.”
 *
 * Why:
 * This middleware wires `pino-http` for access-level telemetry:
 *   - Generates or propagates `x-request-id` so every log line is traceable.
 *   - Applies severity mapping: 2xx/3xx=info, 4xx=warn, 5xx/error=error.
 *   - Sanitizes URLs to strip sensitive path segments (e.g., emails).
 *   - Skips noisy endpoints (health, favicon).
 *   - Binds logs under the gateway’s `serviceName` so all entries are attributable.
 *
 * This is **not** the audit WAL and **not** guardrail security logs. It is
 * lightweight operational telemetry, always fire-and-forget, never blocking.
 */

import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { logger } from "@eff/shared/src/utils/logger";
import { serviceName } from "../config";
import { sanitizeUrl } from "../utils/sanitizeUrl";

export function loggingMiddleware() {
  // WHY: create a child logger bound to this service’s identity, so all pino-http
  // entries carry `{ service: <serviceName> }` without having to inject later.
  const httpLogger = logger.child({ service: serviceName });

  return pinoHttp({
    logger: httpLogger,

    // WHY: adjust log level based on result severity; warn on 4xx, error on 5xx/err.
    customLogLevel(_req, res, err) {
      if (err) return "error";
      const s = res.statusCode;
      if (s >= 500) return "error";
      if (s >= 400) return "warn";
      return "info";
    },

    // WHY: ensure we always have a requestId for correlation; generate UUID if missing.
    genReqId: (req, res) => {
      const hdr =
        req.headers["x-request-id"] ||
        req.headers["x-correlation-id"] ||
        req.headers["x-amzn-trace-id"];
      const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();
      res.setHeader("x-request-id", String(id));
      return String(id);
    },

    // WHY: attach only minimal props (service, reqId) for log context.
    customProps(req) {
      return { service: serviceName, reqId: (req as any).id };
    },

    // WHY: avoid flooding logs with boring endpoints like health/favicons.
    autoLogging: {
      ignore: (req) =>
        req.url === "/health" ||
        req.url === "/health/live" ||
        req.url === "/health/ready" ||
        req.url === "/healthz" ||
        req.url === "/readyz" ||
        req.url === "/favicon.ico",
    },

    // WHY: serializers trim log volume and scrub sensitive info (e.g., email in URL).
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

    // WHY: explicit empty redact config — placeholder to add sensitive headers/fields later.
    redact: { paths: [], remove: true },
  });
}
