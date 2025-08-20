// backend/services/log/src/middleware/authInternal.ts
import type { Request, Response, NextFunction } from "express";
import { isTokenAuthorized } from "../config";

/** Require internal caller auth via x-internal-key (rotation-aware). */
export function requireInternalToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const hdr = req.headers["x-internal-key"];
  const token = Array.isArray(hdr) ? hdr[0] : hdr;

  if (!isTokenAuthorized(typeof token === "string" ? token : undefined)) {
    return res
      .status(401)
      .json({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or missing internal token",
        },
      });
  }
  next();
}
