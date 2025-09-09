// backend/services/gateway/src/middleware/httpsOnly.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • Security & S2S Authorization section
 *   • “Dev/local: HTTP allowed on 127.0.0.1; staging/prod: HTTPS only + HSTS”
 *
 * Why:
 * Enforce HTTPS in environments where TLS termination is expected at the edge.
 * - When `FORCE_HTTPS=true`, we hard-redirect any HTTP request to its HTTPS equivalent.
 * - In dev/local, `FORCE_HTTPS=false` allows plain HTTP for convenience.
 * - The app must call `app.set("trust proxy", true)` so Express respects
 *   `X-Forwarded-Proto` (inserted by load balancers or reverse proxies).
 *
 * This ensures:
 * - No accidental cleartext traffic in production.
 * - Consistent redirect semantics (status 308 = permanent redirect).
 * - Audit clarity: we don’t log rejected HTTP here; it’s not a guardrail denial
 *   but a transparent enforcement. Security logs are reserved for malicious/bot traffic.
 */

import type { Request, Response, NextFunction } from "express";

export function httpsOnly() {
  return (req: Request, res: Response, next: NextFunction) => {
    // WHY: only enforce when explicitly configured; dev/local stays flexible.
    if (process.env.FORCE_HTTPS !== "true") return next();

    // WHY: Express `req.secure` relies on trust proxy being enabled.
    const xf = String(req.headers["x-forwarded-proto"] || "");
    if (req.secure || xf === "https") return next();

    // WHY: use 308 Permanent Redirect so method + body are preserved.
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  };
}
