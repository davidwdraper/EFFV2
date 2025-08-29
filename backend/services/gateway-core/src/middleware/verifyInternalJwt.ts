// backend/services/gateway-core/src/middleware/verifyInternalJwt.ts
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

type JwtPayload = {
  sub?: string;
  iss: string;
  aud: string;
  exp: number; // unix seconds
  nbf?: number;
  iat?: number;
  svc?: string;
  [k: string]: unknown;
};

function b64urlToBuf(b64url: string): Buffer {
  // add correct padding then convert
  const padLen = (4 - (b64url.length % 4 || 4)) % 4;
  const b64 = (b64url + "=".repeat(padLen))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

export function verifyInternalJwt(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const log = (req as any).log || console;

  try {
    const auth = req.headers.authorization || "";
    const [, token] = auth.split(" ");
    if (!token) {
      log.warn({ reason: "missing token" }, "s2s auth fail");
      return res
        .status(401)
        .json({ code: "UNAUTHORIZED", status: 401, message: "Missing token" });
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      log.warn({ reason: "malformed token" }, "s2s auth fail");
      return res
        .status(401)
        .json({
          code: "UNAUTHORIZED",
          status: 401,
          message: "Malformed token",
        });
    }
    const [h, p, s] = parts;

    const secret = process.env.S2S_JWT_SECRET || "";
    const iss = process.env.S2S_JWT_ISSUER || "gateway-core";
    const aud = process.env.S2S_JWT_AUDIENCE || "internal-services";
    if (!secret) {
      log.error({ reason: "missing secret env" }, "s2s auth fail");
      return res
        .status(500)
        .json({
          code: "SERVER_MISCONFIG",
          status: 500,
          message: "Missing S2S_JWT_SECRET",
        });
    }

    // Verify signature
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${h}.${p}`)
      .digest();
    const got = b64urlToBuf(s);
    if (
      expected.length !== got.length ||
      !crypto.timingSafeEqual(expected, got)
    ) {
      log.warn({ reason: "bad signature" }, "s2s auth fail");
      return res
        .status(401)
        .json({
          code: "UNAUTHORIZED",
          status: 401,
          message: "Invalid signature",
        });
    }

    // Decode payload
    let payload: JwtPayload;
    try {
      payload = JSON.parse(b64urlToBuf(p).toString("utf8"));
    } catch {
      log.warn({ reason: "bad payload decode" }, "s2s auth fail");
      return res
        .status(401)
        .json({
          code: "UNAUTHORIZED",
          status: 401,
          message: "Bad token payload",
        });
    }

    // Claims checks
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== iss || payload.aud !== aud) {
      log.warn(
        {
          reason: "claims mismatch",
          iss_expect: iss,
          aud_expect: aud,
          iss_got: payload.iss,
          aud_got: payload.aud,
        },
        "s2s auth fail"
      );
      return res
        .status(401)
        .json({
          code: "UNAUTHORIZED",
          status: 401,
          message: "Invalid iss/aud",
        });
    }
    if (typeof payload.exp !== "number" || payload.exp <= now) {
      log.warn({ reason: "expired", exp: payload.exp, now }, "s2s auth fail");
      return res
        .status(401)
        .json({ code: "UNAUTHORIZED", status: 401, message: "Token expired" });
    }
    if (typeof payload.nbf === "number" && payload.nbf > now) {
      log.warn({ reason: "nbf > now", nbf: payload.nbf, now }, "s2s auth fail");
      return res
        .status(401)
        .json({
          code: "UNAUTHORIZED",
          status: 401,
          message: "Token not yet valid",
        });
    }

    // Success
    (req as any).s2s = {
      sub: payload.sub,
      svc: payload.svc,
      iss: payload.iss,
      aud: payload.aud,
      iat: payload.iat,
      exp: payload.exp,
    };
    return next();
  } catch (err) {
    log.warn({ reason: "exception", err }, "s2s auth fail");
    return res
      .status(401)
      .json({
        code: "UNAUTHORIZED",
        status: 401,
        message: "Token verification failed",
      });
  }
}
