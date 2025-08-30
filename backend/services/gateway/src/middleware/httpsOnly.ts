// backend/services/gateway/src/middleware/httpsOnly.ts
import type { Request, Response, NextFunction } from "express";

export function httpsOnly() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.FORCE_HTTPS !== "true") return next();
    const xf = String(req.headers["x-forwarded-proto"] || "");
    if (req.secure || xf === "https") return next();
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  };
}
