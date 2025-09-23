// backend/services/shared/src/middleware/verifyS2S.ts

/**
 * verifyS2S — ES256/JWKS verification (Google KMS signer upstream)
 * -----------------------------------------------------------------------------
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - Design: docs/design/backend/security/s2s-jwt.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *
 * Why:
 * - ADR-0030 moves signing to the gateway using **Google Cloud KMS** (ES256).
 *   Services must verify S2S tokens against the gateway’s **JWKS**. No shared
 *   secrets in env; only public JWKS and validation rules live here.
 *
 * What:
 * - Express middleware `verifyS2S` that:
 *   • Extracts a Bearer token from Authorization
 *   • Validates ES256 signature via remote JWKS (cached; honors ETag/Cache-Control)
 *   • Enforces `aud` and `iss`
 *   • Applies small clock tolerance
 *   • On success, attaches normalized caller claims to `req.s2s`
 *
 * Env (config-only; no secrets):
 * - S2S_JWKS_URL          e.g. https://gateway.nowvibin.io/.well-known/jwks.json
 * - S2S_REQUIRED_ISS      e.g. "gateway"
 * - S2S_REQUIRED_AUD      e.g. "internal-services"
 * - S2S_CLOCK_TOLERANCE_S default 45   // WHY: handle minor skew across nodes
 *
 * Notes:
 * - Only accepts ES256 (matches KMS key). If you rotate to a different alg,
 *   rotate both KMS key type and this verifier’s allowed algorithms.
 * - We rely on jose’s `createRemoteJWKSet` which respects HTTP caching
 *   headers (Cache-Control/ETag). The gateway’s JWKS route sets both.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import {
  jwtVerify,
  createRemoteJWKSet,
  type JWTPayload,
  errors as joseErr,
} from "jose";
import { logger } from "../utils/logger";

type S2SContext = {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  kid?: string;
  // pass-through of common custom claims (string-only for audit hygiene)
  meta?: Record<string, string>;
};

// Extend Express for downstreams
declare module "express-serve-static-core" {
  interface Request {
    s2s?: S2SContext;
  }
}

const RE_JWT = /^Bearer\s+(.+)$/i;

// WHY: fail fast on misconfig — verification without JWKS or policy makes no sense.
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`[verifyS2S] Missing required env: ${name}`);
  }
  return String(v).trim();
}

const JWKS_URL = requireEnv("S2S_JWKS_URL");
const REQUIRED_ISS = requireEnv("S2S_REQUIRED_ISS");
const REQUIRED_AUD = requireEnv("S2S_REQUIRED_AUD");
const CLOCK_TOL_S = Math.max(
  0,
  Number(process.env.S2S_CLOCK_TOLERANCE_S ?? 45) | 0
);

// WHY: allocate once; jose caches keys per HTTP cache headers.
const JWKS = createRemoteJWKSet(new URL(JWKS_URL), {
  // WHY: tolerate flaky control planes; jose will refetch on cache expiry or kid miss
  cooldownDuration: 1000, // minimal cooldown between failed fetches
});

/** Minimal RFC7807 helper for uniform error shape. */
function problem(status: number, detail: string, instance?: string) {
  return {
    type: "about:blank",
    title:
      status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Error",
    status,
    detail,
    instance: instance ?? "",
  };
}

/** Extract raw JWT from the Authorization header. */
function extractBearer(req: Request): string | undefined {
  const h =
    (req.headers["authorization"] as string | undefined) ??
    ((req.headers as any)["Authorization"] as string | undefined);
  if (!h) return undefined;
  const m = h.match(RE_JWT);
  return (m ? m[1] : h).trim();
}

/** WHY: normalize string-only meta; avoid leaking arbitrary objects to logs. */
function normalizeMetaClaims(payload: JWTPayload): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (["iss", "sub", "aud", "exp", "nbf", "iat", "jti"].includes(k)) continue;
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Middleware: verify S2S JWT via gateway-published JWKS (ES256). */
export function verifyS2S(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = extractBearer(req);
    if (!token) {
      return res
        .status(401)
        .json(problem(401, "Missing bearer token", (req as any).id));
    }

    try {
      // WHY: only accept ES256 — matches KMS key; tighten surface area
      const { payload, protectedHeader } = await jwtVerify(token, JWKS, {
        algorithms: ["ES256"],
        issuer: REQUIRED_ISS,
        audience: REQUIRED_AUD,
        clockTolerance: CLOCK_TOL_S,
      });

      // Attach normalized context for downstream usage and audit correlation
      (req as any).s2s = {
        iss: payload.iss,
        sub: payload.sub,
        aud: payload.aud,
        kid: protectedHeader.kid,
        meta: normalizeMetaClaims(payload),
      } satisfies S2SContext;

      return next();
    } catch (err: any) {
      // WHY: map jose errors to sensible 401/403 without leaking internals
      const rid = (req as any).id;
      if (
        err instanceof joseErr.JWTExpired ||
        err instanceof joseErr.JWTNotActive ||
        err instanceof joseErr.JWSInvalid ||
        err instanceof joseErr.JWTInvalid
      ) {
        logger.warn(
          {
            ch: "SECURITY",
            kind: "s2s_verify",
            decision: "blocked",
            rid,
            reason: err.name,
          },
          "[verifyS2S] JWT rejected"
        );
        const status =
          err instanceof joseErr.JWTExpired ||
          err instanceof joseErr.JWTNotActive
            ? 401
            : 401;
        return res
          .status(status)
          .json(problem(status, "Invalid or expired token", rid));
      }

      // Network / JWKS fetch problems → treat as 503 (policy cannot be enforced)
      logger.error({ rid, err }, "[verifyS2S] JWKS resolution failure");
      return res
        .status(503)
        .json(
          problem(503, "Authorization service temporarily unavailable", rid)
        );
    }
  };
}

export default verifyS2S;
