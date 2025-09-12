// backend/services/shared/src/middleware/verifyS2S.ts
/**
 * Docs:
 * - Design: docs/design/backend/security/s2s-verification.md
 * - Architecture: docs/architecture/backend/SECURITY.md
 * - ADRs:
 *   - docs/adr/0014-s2s-jwt-verification-for-internal-services.md
 *
 * Why:
 * - Internal services must enforce S2S JWT. Health endpoints stay open.
 */

import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload, type VerifyOptions } from "jsonwebtoken";
import { logSecurity } from "@eff/shared/src/utils/securityLog";

const OPEN = new Set([
  "/",
  "/health",
  "/healthz",
  "/readyz",
  "/health/live",
  "/health/ready",
  "/live",
  "/ready",
]);

function csv(name: string, def = ""): string[] {
  return (process.env[name] || def)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function asTupleOrString(
  arr: string[] | undefined
): string | [string, ...string[]] | undefined {
  const a = (arr || []).filter(Boolean);
  if (!a.length) return undefined;
  return a.length === 1 ? a[0] : [a[0], ...a.slice(1)];
}

const AUDIENCE =
  asTupleOrString(csv("S2S_JWT_AUDIENCE")) ?? "internal-services";
const ISSUER_OPT = asTupleOrString(
  csv("S2S_ALLOWED_ISSUERS", "gateway,gateway-core,internal")
);
const ALLOWED_CALLERS = new Set(
  csv("S2S_ALLOWED_CALLERS", "gateway,gateway-core")
);
const S2S_SECRET = process.env.S2S_JWT_SECRET || "";
const ALGS = asTupleOrString(csv("S2S_JWT_ALGS")); // optional

export type S2SClaims = JwtPayload & { svc?: string };

export function verifyS2S(req: Request, res: Response, next: NextFunction) {
  if (OPEN.has(req.path)) return next();

  const raw = req.headers.authorization || "";
  const tok = raw.startsWith("Bearer ") ? raw.slice(7) : "";

  if (!tok) {
    logSecurity(req, {
      kind: "s2s_verify",
      reason: "missing_token",
      decision: "blocked",
      status: 401,
      route: req.path,
      method: req.method,
    });
    return res
      .status(401)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Missing token",
        instance: (req as any).id,
      });
  }

  const verifyOpts: VerifyOptions = {
    audience: AUDIENCE,
    issuer: ISSUER_OPT,
    algorithms: ALGS as any,
  };

  try {
    if (!S2S_SECRET) {
      logSecurity(req, {
        kind: "s2s_verify",
        reason: "server_misconfig_missing_secret",
        decision: "blocked",
        status: 503,
        route: req.path,
        method: req.method,
      });
      return res
        .status(503)
        .type("application/problem+json")
        .json({
          type: "about:blank",
          title: "Service Unavailable",
          status: 503,
          detail: "S2S verification misconfigured",
          instance: (req as any).id,
        });
    }

    const payload = jwt.verify(tok, S2S_SECRET, verifyOpts) as S2SClaims;

    if (payload?.svc && !ALLOWED_CALLERS.has(payload.svc)) {
      logSecurity(req, {
        kind: "s2s_verify",
        reason: "caller_not_allowed",
        decision: "blocked",
        status: 403,
        route: req.path,
        method: req.method,
        details: { svc: payload.svc },
      });
      return res
        .status(403)
        .type("application/problem+json")
        .json({
          type: "about:blank",
          title: "Forbidden",
          status: 403,
          detail: "Caller not allowed",
          instance: (req as any).id,
        });
    }

    (req as any).s2s = payload;
    return next();
  } catch (err: any) {
    const reason =
      err?.name === "TokenExpiredError"
        ? "token_expired"
        : err?.name === "JsonWebTokenError"
        ? "invalid_token"
        : "verify_failed";
    logSecurity(req, {
      kind: "s2s_verify",
      reason,
      decision: "blocked",
      status: 401,
      route: req.path,
      method: req.method,
    });
    return res
      .status(401)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: reason.replace(/_/g, " "),
        instance: (req as any).id,
      });
  }
}
