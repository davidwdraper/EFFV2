// backend/services/log/src/middleware/authInternal.ts
import type { Request, Response, NextFunction } from "express";
import { isTokenAuthorized } from "../config";

function fromEnv(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/** Require internal caller auth via x-internal-key (rotation-aware). */
export function requireInternalToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const hdr = req.headers["x-internal-key"];
  const token = Array.isArray(hdr) ? hdr[0] : hdr;

  const provided = typeof token === "string" ? token : undefined;
  const curr = fromEnv("LOG_SERVICE_TOKEN_CURRENT");
  const nextTok = fromEnv("LOG_SERVICE_TOKEN_NEXT");

  const ok =
    (!!provided &&
      (provided === curr || (nextTok ? provided === nextTok : false))) ||
    isTokenAuthorized(provided); // allow provider-implementation too

  if (!ok) {
    return res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing internal token",
      },
    });
  }
  return next();
}
