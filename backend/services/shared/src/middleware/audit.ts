// backend/services/shared/middleware/audit.ts
import type { Request, Response, NextFunction } from "express";
import { extractLogContext, postAudit } from "@eff/shared/src/utils/logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      audit?: Array<Record<string, any>>;
    }
  }
}

const IS_PROD = process.env.NODE_ENV === "production";
const ENABLE_INFO_DEBUG =
  String(process.env.LOG_ENABLE_INFO_DEBUG || "").toLowerCase() === "true";

export function auditBuffer() {
  return (req: Request, res: Response, next: NextFunction) => {
    req.audit = [];

    res.on("finish", () => {
      const buf = req.audit;
      if (!buf || buf.length === 0) return;

      // Merge stable request context into each audit event (service, requestId, path, etc.)
      const ctx = extractLogContext(req);
      const events = buf.map((e) => ({ ...ctx, ...e }));

      // Fire-and-forget: logger util handles LogSvc/FS/notify per SOP
      void postAudit(events);

      // Telemetry: only emit locally in dev/test (or if explicitly enabled in prod)
      if (!IS_PROD || ENABLE_INFO_DEBUG) {
        // pino-http attaches req.log
        req.log?.info(
          { count: events.length, path: req.originalUrl },
          "audit:flush"
        );
      }
    });

    next();
  };
}
