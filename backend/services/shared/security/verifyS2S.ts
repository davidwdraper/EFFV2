// backend/services/shared/middleware/verifyS2S.ts
/**
 * Shared middleware: verifyS2S
 * -------------------------------------------------------
 * WHEN THIS LOGIC IS REPLACED, DO NOT HAVE A RUNTIME S2S_OPEN SWITCH!
 *
 * TEMPORARY OPEN MODE FOR DEV/SMOKE
 * - If S2S_OPEN=1, all S2S calls are accepted (signature,
 *   issuer and audience checks are skipped).
 * - Otherwise falls back to normal HS256 verification
 *   (signature + exp + aud).
 *
 * REMOVE the S2S_OPEN branch once the permanent svcconfig-based
 * auth is in place.
 */

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const OPEN = (process.env.S2S_OPEN || "0") === "1";
const SECRET = process.env.S2S_JWT_SECRET || "";
const REQ_AUD = process.env.S2S_JWT_AUDIENCE || "internal-services";
const CLOCK_SKEW = Number(process.env.S2S_CLOCK_SKEW_SEC || "60");

function problem(title: string, detail: string) {
  const instance =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto as any).randomUUID()
      : String(Math.random()).slice(2);
  return {
    type: "about:blank",
    title,
    status: title === "Unauthorized" ? 401 : 403,
    detail,
    instance,
  };
}

/**
 * verifyS2S
 * Express middleware to protect /api routes
 */
export function verifyS2S(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // ---- Temporary open mode ----
  if (OPEN) {
    (req as any).s2s = { iss: "open", aud: REQ_AUD, sub: "s2s" };
    return next();
  }

  // ---- Standard HS256 verification ----
  const hdr = req.header("authorization") || req.header("Authorization");
  if (!hdr?.startsWith("Bearer ")) {
    res.status(401).json(problem("Unauthorized", "missing bearer token"));
    return;
  }
  const token = hdr.slice("Bearer ".length).trim();

  try {
    const payload = jwt.verify(token, SECRET, {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;

    // Basic time check with skew
    if (
      typeof payload.exp === "number" &&
      payload.exp * 1000 < Date.now() - CLOCK_SKEW * 1000
    ) {
      res.status(401).json(problem("Unauthorized", "token expired"));
      return;
    }

    // Audience must match even in open mode off
    if (payload.aud !== REQ_AUD) {
      res.status(403).json(problem("Forbidden", "audience mismatch"));
      return;
    }

    // NOTE: issuer check intentionally skipped for now.
    (req as any).s2s = {
      iss: payload.iss,
      aud: payload.aud,
      sub: payload.sub,
      svc: (payload as any).svc,
    };
    next();
  } catch (_err) {
    res.status(401).json(problem("Unauthorized", "invalid token"));
  }
}
