// backend/services/gateway/src/middleware/httpsOnly.ts
import type { Request, Response, NextFunction } from "express";

/**
 * Enforce HTTPS when FORCE_HTTPS=true.
 * - Dev/local: set FORCE_HTTPS=false to allow HTTP.
 * - Behind a proxy/LB, app.set("trust proxy", true) must be enabled to honor X-Forwarded-Proto.
 */
export function httpsOnly() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.FORCE_HTTPS !== "true") return next();
    const xf = String(req.headers["x-forwarded-proto"] || "");
    if (req.secure || xf === "https") return next();
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  };
}
