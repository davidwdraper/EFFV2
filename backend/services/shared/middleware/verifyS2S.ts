// backend/services/shared/middleware/verifyS2S.ts

/**
 * Docs:
 * - Design: docs/design/backend/security/s2s-verification.md
 * - Architecture: docs/architecture/backend/SECURITY.md
 * - ADRs:
 *   - docs/adr/0014-s2s-jwt-verification-for-internal-services.md
 *
 * Why:
 * - Only the gateway (and gateway-core) are public. All internal service calls
 *   must carry a valid S2S JWT. This middleware verifies the token, enforces
 *   allowed issuers/callers, and exposes the parsed claims on `req.s2s`.
 *
 * Notes:
 * - Health endpoints are open by policy.
 * - SECURITY vs AUDIT split: verification denials are SECURITY telemetry only.
 * - TypeScript: jsonwebtoken’s types expect non-empty arrays for multi-valued
 *   options (e.g., `issuer?: string | [string, ...string[]]`). We coerce env
 *   lists accordingly to avoid “No overload matches this call.”
 */

import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload, type VerifyOptions } from "jsonwebtoken";
import { logSecurity } from "../utils/securityLog";

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

// ────────────────────────────── Env parsing helpers ───────────────────────────
function csv(name: string, def = ""): string[] {
  const raw = (process.env[name] || def)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return raw;
}

/** Coerce a string[] into the types jsonwebtoken expects:
 * - 0 items  -> undefined
 * - 1 item   -> string
 * - >=2 items-> [first, ...rest] (non-empty tuple)
 */
function asStringOrNonEmptyTuple(
  arr: string[] | undefined
): string | [string, ...string[]] | undefined {
  const a = (arr || []).filter(Boolean);
  if (a.length === 0) return undefined;
  if (a.length === 1) return a[0];
  return [a[0], ...a.slice(1)];
}

// Audience can be single or list (comma-separated)
const AUD_LIST = csv("S2S_JWT_AUDIENCE"); // e.g., "internal-services,svc"
const AUDIENCE = asStringOrNonEmptyTuple(AUD_LIST) ?? "internal-services";

// Issuers allowed (minted by gateway/gateway-core/etc.)
const ALLOWED_ISS = csv("S2S_ALLOWED_ISSUERS", "gateway,gateway-core,internal");
const ISSUER_OPT = asStringOrNonEmptyTuple(ALLOWED_ISS);

// Allowed caller service slugs (custom claim `svc`)
const ALLOWED_CALLERS = new Set(
  csv("S2S_ALLOWED_CALLERS", "gateway,gateway-core")
);

// HS shared secret for dev; production should use asymmetric keys/JWKS per ADR-0014.
const S2S_SECRET = process.env.S2S_JWT_SECRET || "";

// Optional: algorithms (non-empty tuple if multiple)
const ALGS = asStringOrNonEmptyTuple(csv("S2S_JWT_ALGS")); // e.g., "RS256,ES256" or "HS256"

/** Shape we expect in S2S token (add fields as needed). */
export type S2SClaims = JwtPayload & {
  svc?: string; // caller service slug
};

// ─────────────────────────────── Middleware impl ──────────────────────────────
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

  // Build verify options with correct types. Omit fields rather than pass empty arrays.
  const verifyOpts: VerifyOptions = {
    audience: AUDIENCE,
    issuer: ISSUER_OPT,
    algorithms: ALGS as any, // jsonwebtoken types accept string | string[] non-empty tuple; our helper ensures that
  };

  try {
    // For now we support HS* secret verification; production should prefer RS*/ES* with JWKS.
    if (!S2S_SECRET) {
      // Treat misconfiguration as server error (503) vs 401/403 (client fault)
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

    // Enforce allowed callers via custom `svc` claim.
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

    // Attach parsed claims for downstream handlers.
    (req as any).s2s = payload;
    return next();
  } catch (err: any) {
    const reason =
      err?.name === "TokenExpiredError"
        ? "token_expired"
        : err?.name === "JsonWebTokenError"
        ? "invalid_token"
        : "verify_failed";

    const status =
      reason === "token_expired" || reason === "invalid_token" ? 401 : 401;

    logSecurity(req, {
      kind: "s2s_verify",
      reason,
      decision: "blocked",
      status,
      route: req.path,
      method: req.method,
    });

    return res
      .status(status)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        title: "Unauthorized",
        status,
        detail: reason.replace(/_/g, " "),
        instance: (req as any).id,
      });
  }
}
