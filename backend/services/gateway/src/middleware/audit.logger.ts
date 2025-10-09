// backend/services/gateway/src/middleware/audit.logger.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0006 (Gateway Edge Logging — pre-audit, toggleable)
 *   - ADR-0022 (Shared WAL & DB Base; environment invariance)
 *
 * Purpose:
 * - Emits "begin" on request entry and exactly one "end" on response completion.
 * - Never throws; auditing must never break traffic.
 *
 * Mount order (required):
 *   edgeHitLogger()  →  auditLogger(audit)  →  proxy  →  error funnel
 */

import type { Request, Response, NextFunction } from "express";
import { GatewayAuditService } from "../services/audit/GatewayAuditService";

export function auditLogger(audit: GatewayAuditService) {
  return function auditLoggerMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    try {
      audit.recordBegin(req);
    } catch {
      // auditing must be non-fatal; swallow
    }

    // Ensure we emit "end" exactly once regardless of how the response terminates.
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      try {
        audit.recordEnd(req, res);
      } catch {
        // non-fatal
      }
    };

    res.once("finish", finish); // normal completion
    res.once("close", finish); // client aborts or socket closes
    res.once("error", finish); // stream error path

    next();
  };
}
