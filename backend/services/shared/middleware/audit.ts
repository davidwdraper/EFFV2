// backend/services/shared/middleware/audit.ts
import type { Request, Response, NextFunction } from "express";
import { extractLogContext, postAudit } from "../utils/logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      audit?: Array<Record<string, any>>;
    }
  }
}

export function auditBuffer() {
  return (req: Request, res: Response, next: NextFunction) => {
    req.audit = [];
    res.on("finish", () => {
      if (req.audit && req.audit.length) {
        const ctx = extractLogContext(req);
        const events = req.audit.map((e) => ({ ...ctx, ...e }));
        void postAudit(events);
        req.log.info(
          { msg: "audit:flush", count: events.length },
          "audit events flushed"
        );
      }
    });
    next();
  };
}
