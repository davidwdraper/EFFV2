// backend/services/log/src/middleware/requireJson.ts
import type { Request, Response, NextFunction } from "express";

/** Enforce application/json for ingest endpoints. */
export function requireJson(req: Request, res: Response, next: NextFunction) {
  const type = req.headers["content-type"];
  // Accept exact or with charset suffix
  if (
    typeof type === "string" &&
    type.toLowerCase().startsWith("application/json")
  ) {
    return next();
  }
  return res.status(415).json({
    error: {
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "application/json required",
    },
  });
}
