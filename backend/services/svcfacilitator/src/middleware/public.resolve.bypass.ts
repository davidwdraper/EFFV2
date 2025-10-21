// backend/services/svcfacilitator/src/middleware/public.resolve.bypass.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0035 — JWKS Service for Public Keys
 * - ADR-0037 — RoutePolicyGate drives S2S policy (UPCOMING)
 * - ADR-0038 — Facilitator endpoint policies (UPCOMING)
 *
 * Purpose (TEMPORARY — REMOVE AFTER ADR-0037 LANDS):
 * - Allow GET /api/svcfacilitator/v1/resolve without S2S auth (public).
 * - Must run BEFORE any verifyS2S middleware (when added).
 *
 * Invariants:
 * - Explicit opt-in required: NV_ALLOW_PUBLIC_RESOLVE_BYPASS === "true".
 *   Throws at mount if not set — tripwire so this can’t linger.
 * - No env fallbacks. Dev == Prod semantics.
 */

import type { Request, Response, NextFunction } from "express";

const PUBLIC_RESOLVE_PATH = "/api/svcfacilitator/v1/resolve";

type LoggerLike = {
  warn: (msg: string, ...rest: unknown[]) => void;
};

export function publicResolveBypass(logger?: LoggerLike) {
  if (process.env.NV_ALLOW_PUBLIC_RESOLVE_BYPASS !== "true") {
    throw new Error(
      "[publicResolveBypass] NV_ALLOW_PUBLIC_RESOLVE_BYPASS must be 'true' while this TEMPORARY bypass is in use"
    );
  }

  logger?.warn("mounting TEMPORARY facilitator public bypass", {
    component: "publicResolveBypass",
    path: PUBLIC_RESOLVE_PATH,
    note: "REMOVE when ADR-0037 policy enables proper public routing",
  });

  return function (req: Request, _res: Response, next: NextFunction) {
    if (req.method === "GET" && req.path === PUBLIC_RESOLVE_PATH) {
      (req as any).nvIsPublic = true; // downstream guards may honor this
      return next();
    }
    return next();
  };
}
