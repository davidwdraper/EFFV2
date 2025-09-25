// backend/services/shared/middleware/httpLogger.ts

/**
 * Docs:
 * - Design: docs/design/backend/observability/http-logging.md
 * - Architecture: docs/architecture/backend/OBSERVABILITY.md
 * - ADRs:
 *   - docs/adr/0005-request-id-standardization.md
 *   - docs/adr/0006-http-telemetry-with-pino-http.md
 *
 * Why:
 * - We need consistent, structured request logs across all services so ops can
 *   aggregate by `service` and correlate by `reqId` end-to-end.
 * - This middleware is *telemetry only*. It must never block requests or be
 *   conflated with:
 *     • Audit WAL (billing-grade) or
 *     • SECURITY logs (guardrail denials).
 *
 * Order:
 * - Mount this immediately after `requestIdMiddleware`. That ensures `req.id`
 *   is already populated so every log line carries the same correlation key
 *   used by guardrails and the WAL.
 *
 * Notes:
 * - Severity mapping: 2xx/3xx=info, 4xx=warn, 5xx/error=error.
 * - We avoid log spam from health/favicons.
 * - We *reuse* an existing requestId if present; only mint a UUID if missing
 *   (important for multi-hop traces and correctness under retries).
 */

import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { logger as rootLogger } from "@eff/shared/src/utils/logger";

export function makeHttpLogger(serviceName: string) {
  // WHY: bind a child logger so every entry carries `{ service: <slug> }`
  const logger = rootLogger.child({ service: serviceName });

  return pinoHttp({
    logger,

    /**
     * Keep pino-http's internal req.id aligned with our requestId middleware:
     * - If `req.id` exists, reuse it.
     * - Else accept common correlation headers.
     * - Else mint a UUIDv4.
     * Always echo `x-request-id` so callers can correlate across hops.
     */
    genReqId: (req, res) => {
      const existing = (req as any).id as string | undefined;
      if (existing) {
        res.setHeader("x-request-id", existing);
        return existing;
      }
      const hdr =
        (req.headers["x-request-id"] as string | undefined) ||
        (req.headers["x-correlation-id"] as string | undefined) ||
        (req.headers["x-amzn-trace-id"] as string | undefined);
      const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();
      (req as any).id = String(id);
      res.setHeader("x-request-id", String(id));
      return String(id);
    },

    // WHY: grade severity by outcome so noisy 4xx don’t drown true failures.
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

    /**
     * WHY: attach stable, minimal fields every log line should carry.
     * - reqId → correlation across gateway/core/workers
     * - service → quick scoping/filters
     * - route (best-effort) and userId (if auth attached) aid triage
     */
    customProps: (req: IncomingMessage) => {
      const r = req as any;
      const userId = r?.user?.userId || r?.auth?.userId;
      const reqId = r?.id;
      const route = r?.route?.path;
      return { service: serviceName, reqId, route, userId };
    },

    // WHY: avoid flooding logs with boring endpoints that run constantly.
    autoLogging: {
      ignore: (req: IncomingMessage) => {
        const url = (req as any).url as string | undefined;
        return (
          url === "/health" ||
          url === "/health/live" ||
          url === "/health/ready" ||
          url === "/healthz" ||
          url === "/readyz" ||
          url === "/favicon.ico"
        );
      },
    },

    /**
     * WHY: keep serialized payloads lean and consistent.
     * (If/when we add URL sanitization, swap `url: r.url` for a shared
     *  sanitizeUrl(r.url) without changing call sites.)
     */
    serializers: {
      req(req: IncomingMessage) {
        const r = req as any;
        return { id: r.id, method: r.method, url: r.url };
      },
      res(res: ServerResponse) {
        return { statusCode: res.statusCode };
      },
      err(err: Error) {
        return { type: err.name, msg: err.message };
      },
    },

    // Placeholder for future header/body scrubs; keep explicit for auditability.
    redact: { paths: [], remove: true },
  });
}
