// backend/services/shared/src/middleware/verifyS2S.ts
/**
 * verifyS2S — minimal S2S guardrail (shared)
 * -----------------------------------------------------------------------------
 * Policy (current iteration):
 *   - Validate HS256 signature & expiry using S2S_JWT_SECRET. (401 on failure)
 *   - Require aud === S2S_JWT_AUDIENCE.                              (403)
 *   - If S2S_JWT_ISSUER is set (non-empty), require iss === that.    (403)
 *   - No caller/issuer allowlists. No per-service allow/deny tables.
 *
 * Rationale:
 *   You mandated services be "open to all NV certified callers" until the new
 *   svcconfig-driven caller identity ships. This middleware enforces only the
 *   minimally correct S2S invariants while avoiding config drift between
 *   dev/test/prod.
 *
 * Env:
 *   - S2S_JWT_SECRET      (required)
 *   - S2S_JWT_AUDIENCE    (required)
 *   - S2S_JWT_ISSUER      (optional; if empty -> issuer not enforced)
 *   - S2S_CLOCK_SKEW_SEC  (optional; default 0)
 *
 * Failure codes:
 *   - 401 Unauthorized: missing token, bad signature, expired, malformed.
 *   - 403 Forbidden:    valid token but aud/iss fails policy.
 *
 * Logging:
 *   Emits SECURITY log with reason in {missing_token|jwt_invalid|aud_mismatch|
 *   iss_mismatch} and kind "s2s_verify". Never logs raw tokens or claims.
 */

import type { Request, Response, NextFunction } from "express";
import * as crypto from "node:crypto";
import { logger } from "../utils/logger";

type JwtHeader = { alg: string; typ?: string };
type JwtPayload = {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  [k: string]: unknown;
};

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 2 ? "==" : input.length % 4 === 3 ? "=" : "";
  const s = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(s, "base64");
}

function hmacSha256(secret: string, data: string): Buffer {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractBearer(req: Request): string | undefined {
  const h =
    (req.headers["authorization"] as string | undefined) ??
    (req.headers["Authorization"] as unknown as string | undefined);
  if (typeof h === "string" && h.trim()) {
    const m = /^Bearer\s+(.+)$/i.exec(h.trim());
    return m ? m[1] : h.trim();
  }
  return undefined;
}

function secLog(
  req: Request,
  reason: string,
  status: number,
  extra?: Record<string, unknown>
) {
  logger.warn(
    {
      ch: "SECURITY",
      service: (process.env.SERVICE_NAME as string) || "unknown",
      requestId: (req as any).id,
      reason,
      decision: status >= 400 ? "blocked" : "allowed",
      status,
      route: req.path,
      method: req.method,
      kind: "s2s_verify",
      ...(extra || {}),
    },
    "security guardrail decision"
  );
}

export function verifyS2S(req: Request, res: Response, next: NextFunction) {
  const secret = String(process.env.S2S_JWT_SECRET || "");
  const expectedAud = String(process.env.S2S_JWT_AUDIENCE || "");
  const expectedIss = (process.env.S2S_JWT_ISSUER || "").trim(); // optional
  const clockSkewSec = Number(process.env.S2S_CLOCK_SKEW_SEC || 0);

  if (!secret || !expectedAud) {
    // Config problem → treat as 503 (service misconfig), not client fault.
    secLog(req, "s2s_misconfigured", 503);
    return res.status(503).json({
      type: "about:blank",
      title: "Auth Misconfigured",
      status: 503,
      detail: "S2S config invalid (missing secret or audience).",
      instance: (req as any).id,
    });
  }

  const token = extractBearer(req);
  if (!token) {
    secLog(req, "missing_token", 401);
    return res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "Missing token",
      instance: (req as any).id,
    });
  }

  try {
    // Parse JWT compact form
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("malformed");
    const [hB64, pB64, sigB64] = parts;

    const header = JSON.parse(b64urlDecode(hB64).toString("utf8")) as JwtHeader;
    const payload = JSON.parse(
      b64urlDecode(pB64).toString("utf8")
    ) as JwtPayload;

    if (!header || header.alg !== "HS256") throw new Error("alg_not_supported");

    // Verify signature
    const data = `${hB64}.${pB64}`;
    const expected = hmacSha256(secret, data);
    const given = b64urlDecode(sigB64);
    if (!timingSafeEqual(expected, given)) throw new Error("bad_signature");

    // Expiry & not-before
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      typeof payload.exp === "number" &&
      nowSec > payload.exp + clockSkewSec
    ) {
      throw new Error("expired");
    }
    if (
      typeof payload.nbf === "number" &&
      nowSec + clockSkewSec < payload.nbf
    ) {
      throw new Error("not_yet_valid");
    }

    // Audience must match exactly (or be in array)
    const aud = payload.aud;
    const audOk =
      typeof aud === "string"
        ? aud === expectedAud
        : Array.isArray(aud)
        ? aud.includes(expectedAud)
        : false;
    if (!audOk) {
      secLog(req, "aud_mismatch", 403);
      return res.status(403).json({
        type: "about:blank",
        title: "Forbidden",
        status: 403,
        detail: "Audience not allowed",
        instance: (req as any).id,
      });
    }

    // Issuer: only enforce if env is set (open policy otherwise)
    if (expectedIss) {
      if (payload.iss !== expectedIss) {
        secLog(req, "iss_mismatch", 403);
        return res.status(403).json({
          type: "about:blank",
          title: "Forbidden",
          status: 403,
          detail: "Issuer not allowed",
          instance: (req as any).id,
        });
      }
    }

    // Attach normalized caller info for downstream (no PII; only S2S)
    (req as any).caller = {
      iss: payload.iss || "unknown",
      sub: payload.sub || "s2s",
      aud: payload.aud,
    };

    // Success path — do not spam SECURITY logs.
    return next();
  } catch (_err) {
    // Any parse/signature/expiry failure → 401
    secLog(req, "jwt_invalid", 401);
    return res.status(401).json({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "invalid token",
      instance: (req as any).id,
    });
  }
}

export default verifyS2S;
