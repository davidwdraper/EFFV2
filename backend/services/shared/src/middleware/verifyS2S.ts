// PATH: backend/services/shared/src/middleware/verifyS2S.ts

/**
 * verifyS2S — shared S2S JWT verification (KMS / ES256 via JWKS)
 * -----------------------------------------------------------------------------
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *
 * Why:
 * - Under the KMS design, **only the gateway signs** S2S JWTs using a Google KMS
 *   asymmetric key (ES256). All verifiers (workers & gateway private routes)
 *   must verify against the **gateway’s JWKS** — no symmetric secret anywhere.
 *
 * Policy (no fallbacks):
 * - alg: ES256 only
 * - iss: S2S_JWT_ISSUER (exact match)
 * - aud: S2S_JWT_AUDIENCE (exact match)
 * - exp/nbf honored with S2S_CLOCK_SKEW_SEC tolerance
 * - JWKS fetched from S2S_JWKS_URL and cached in-process
 *
 * Env (required, hard fail if missing):
 *   S2S_JWKS_URL          e.g., https://gateway.internal/.well-known/jwks.json
 *   S2S_JWT_ISSUER        e.g., gateway
 *   S2S_JWT_AUDIENCE      e.g., internal-services
 *   S2S_CLOCK_SKEW_SEC    e.g., 60
 *   S2S_JWKS_COOLDOWN_MS  e.g., 30000   // how long to keep stale JWKS before re-fetch
 *   S2S_JWKS_TIMEOUT_MS   e.g., 1500    // fetch timeout for the JWKS endpoint
 *
 * Behavior:
 * - Uses jose’s createRemoteJWKSet (ETag-aware) with strict alg=ES256.
 * - On success, attaches `req.caller = { iss, sub, aud, jti?, kid? }`.
 * - On failure, returns RFC7807 Problem+JSON (401/403) without leaking internals.
 *
 * Notes:
 * - This entirely replaces any HS256 secret-based verifier. **Do not require
 *   S2S_JWT_SECRET** anywhere in KMS mode.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import {
  createRemoteJWKSet,
  jwtVerify,
  errors as JoseErrors,
  JWTPayload,
} from "jose";
import { requireEnv, requireNumber } from "../env";
import { logger } from "../utils/logger";

// ── Strict envs (no defaults) ────────────────────────────────────────────────
const S2S_JWKS_URL = requireEnv("S2S_JWKS_URL");
const S2S_ISSUER = requireEnv("S2S_JWT_ISSUER");
const S2S_AUDIENCE = requireEnv("S2S_JWT_AUDIENCE");
const CLOCK_SKEW_SEC = requireNumber("S2S_CLOCK_SKEW_SEC");
const JWKS_COOLDOWN_MS = requireNumber("S2S_JWKS_COOLDOWN_MS");
const JWKS_TIMEOUT_MS = requireNumber("S2S_JWKS_TIMEOUT_MS");

// ── Remote JWKS (module-scoped, single instance) ─────────────────────────────
const jwksUrl = new URL(S2S_JWKS_URL);
// jose will honor HTTP cache (ETag/Cache-Control) and apply cooldown to avoid storms.
const JWKS = createRemoteJWKSet(jwksUrl, {
  cooldownDuration: JWKS_COOLDOWN_MS,
  timeoutDuration: JWKS_TIMEOUT_MS,
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function extractBearer(req: Request): string | undefined {
  const raw =
    (req.headers["authorization"] as string | undefined) ??
    ((req.headers as any)["Authorization"] as string | undefined);
  if (!raw) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1] : raw.trim();
}

function problem(
  status: number,
  title: string,
  detail: string,
  req: Request
): {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
} {
  const rid =
    (req as any).id ||
    (req.headers["x-request-id"] as string | undefined) ||
    (req.headers["x-correlation-id"] as string | undefined) ||
    undefined;
  return {
    type: "about:blank",
    title,
    status,
    detail,
    ...(rid ? { instance: rid } : {}),
  };
}

// ── Middleware ───────────────────────────────────────────────────────────────
export function verifyS2S(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = extractBearer(req);
      if (!token) {
        return res
          .status(401)
          .type("application/problem+json")
          .json(problem(401, "Unauthorized", "Missing bearer token", req));
      }

      const { payload, protectedHeader } = await jwtVerify(token, JWKS, {
        algorithms: ["ES256"], // KMS key is ES256; lock it down
        issuer: S2S_ISSUER,
        audience: S2S_AUDIENCE,
        clockTolerance: CLOCK_SKEW_SEC,
      });

      const p = payload as JWTPayload & Record<string, unknown>;
      (req as any).caller = {
        iss: String(p.iss || ""),
        sub: String(p.sub || "s2s"),
        aud: p.aud,
        jti: p.jti,
        svc: typeof p.svc === "string" ? p.svc : undefined,
        kid: protectedHeader.kid,
      };

      return next();
    } catch (err: unknown) {
      // jose error taxonomy (v6):
      if (err instanceof JoseErrors.JWTExpired) {
        return res
          .status(401)
          .type("application/problem+json")
          .json(problem(401, "Unauthorized", "token expired", req));
      }

      if (err instanceof JoseErrors.JWTClaimValidationFailed) {
        const claim = (err as any).claim as string | undefined;

        if (claim === "nbf") {
          return res
            .status(401)
            .type("application/problem+json")
            .json(problem(401, "Unauthorized", "token not yet valid", req));
        }

        if (claim === "aud" || claim === "iss") {
          return res
            .status(403)
            .type("application/problem+json")
            .json(problem(403, "Forbidden", `${claim} mismatch`, req));
        }

        return res
          .status(401)
          .type("application/problem+json")
          .json(problem(401, "Unauthorized", "invalid token claims", req));
      }

      // Signature / structure / jwks fetch failures
      logger.debug({ err }, "[verifyS2S] verification failure");
      return res
        .status(401)
        .type("application/problem+json")
        .json(problem(401, "Unauthorized", "invalid token", req));
    }
  };
}

export default verifyS2S;
