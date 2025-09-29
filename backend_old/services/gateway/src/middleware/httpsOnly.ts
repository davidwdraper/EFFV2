// backend/services/gateway/src/middleware/httpsOnly.ts

/**
 * HTTPS Enforcement (edge redirect → 308)
 * -----------------------------------------------------------------------------
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - Design: docs/design/backend/gateway/app.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md   // consistent edge posture
 *
 * Why:
 * - In environments where TLS terminates at the edge, **all** inbound traffic
 *   must arrive over HTTPS. This middleware performs a strict 308 redirect for
 *   any HTTP request when the operator has explicitly enabled enforcement.
 *
 * Policy:
 * - Activation is explicit: only when `FORCE_HTTPS === "true"`.
 *   (No implied defaults; dev/local remains flexible unless you flip the switch.)
 * - `app.set("trust proxy", true)` must be set so Express honors `X-Forwarded-Proto`.
 *
 * Notes:
 * - 308 preserves method + body on redirect, preventing accidental method downgrades.
 * - We don’t SECURITY-log redirects; this is transparent transport hygiene, not a denial.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";

export function httpsOnly(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // WHY: only enforce when the operator explicitly opts in (no silent fallbacks).
    if (process.env.FORCE_HTTPS !== "true") return next();

    // WHY: trust-proxy must be on so `req.secure` reflects `X-Forwarded-Proto`.
    const xfProto = (req.headers["x-forwarded-proto"] as string) || "";
    const isHttps = req.secure || xfProto.toLowerCase() === "https";
    if (isHttps) return next();

    // WHY: use 308 so POST/PUT bodies aren’t discarded by clients.
    const host = (req.headers.host as string) || "";
    // If Host is missing (misbehaving client), fall back to absolute path—better than 500.
    const target = host
      ? `https://${host}${req.originalUrl}`
      : `https://${req.originalUrl}`;
    return res.redirect(308, target);
  };
}
