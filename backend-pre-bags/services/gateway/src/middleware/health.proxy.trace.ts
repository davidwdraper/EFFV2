// backend/services/gateway/src/middleware/health.proxy.trace.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Emit lightweight logs for proxied health calls (before + after),
 *   so Ops can see mapping and failure without full debug noise.
 * - No behavior change; just logs.
 */

import type { Request, Response, NextFunction } from "express";

type IBoundLogger = {
  info: (o: any, m?: string) => void;
  error: (o: any, m?: string) => void;
};

export function healthProxyTrace(opts: { logger: IBoundLogger }) {
  const log = opts.logger;
  return function healthProxyTraceMw(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const url = (req.originalUrl || req.url) ?? "";
    if (!/^\/api\/[^/]+\/v\d+\/health(?:\/|$)/.test(url)) return next();

    const start = Date.now();
    log.info({ method: req.method, url }, "proxy_health_begin");

    res.on("finish", () => {
      const ms = Date.now() - start;
      const code = res.statusCode;
      const level = code >= 500 ? "error" : "info";
      (log as any)[level](
        { method: req.method, url, statusCode: code, ms },
        "proxy_health_end"
      );
    });

    next();
  };
}
