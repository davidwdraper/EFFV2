// backend/services/shared/src/middleware/unwrapEnvelope.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 * - ADRs:
 *   - adr0021-user-opaque-password-hash (controllers expect flat DTOs)
 *
 * Purpose:
 * - If req.body looks like an S2S Envelope<{...}> with meta.scheme === "s2s",
 *   replace req.body with req.body.data so controllers see flat DTOs.
 *
 * Order (per service app.ts):
 *   health → (verifyS2S if present) → express.json → unwrapEnvelope → routes → problem
 */

import type { Request, Response, NextFunction } from "express";

type MaybeEnvelope = {
  meta?: { scheme?: unknown; requestId?: string; [k: string]: unknown };
  data?: unknown;
};

export function unwrapEnvelope() {
  return function unwrapEnvelopeMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
  ): void {
    const b = req.body as MaybeEnvelope | undefined;
    if (b && b.meta && (b.meta as any).scheme === "s2s" && "data" in b) {
      // Optionally stash requestId for loggers if header missing
      if (b.meta?.requestId && !req.headers["x-request-id"]) {
        (req as any).__requestId = b.meta.requestId;
      }
      // Unwrap to the inner DTO expected by controllers
      req.body = (b as any).data;
    }
    next();
  };
}
