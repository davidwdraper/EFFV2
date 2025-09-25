// /backend/services/shared/src/middleware/verifyS2S.ts
/**
 * verifyS2S — shared S2S JWT verification (KMS / ES256 via JWKS)
 * -----------------------------------------------------------------------------
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *
 * Final baseline:
 * - @eff/shared emits CommonJS; `jose` is ESM-only → use **dynamic import**.
 * - No barrels/shims per SOP. Intra-package imports are **relative**.
 * - Strict policy (ES256, exact iss/aud, bounded clock skew).
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";

import { requireEnv, requireNumber } from "@eff/shared/src/utils/env";
import { logger } from "@eff/shared/src/utils/logger";

// ── Lazy config/JWKS (defer env reads; memoize once) ─────────────────────────
type S2SConfig = {
  issuer: string;
  audience: string;
  clockSkewSec: number;
  jwksCooldownMs: number;
  jwksTimeoutMs: number;
  // createRemoteJWKSet returns a function that resolves keys for jwtVerify
  jwks: any;
};

let memo: S2SConfig | null = null;

async function getS2SConfig(): Promise<S2SConfig> {
  if (memo) return memo;

  const jwksUrlStr = requireEnv("S2S_JWKS_URL");
  const issuer = requireEnv("S2S_JWT_ISSUER");
  const audience = requireEnv("S2S_JWT_AUDIENCE");
  const clockSkewSec = requireNumber("S2S_CLOCK_SKEW_SEC");
  const jwksCooldownMs = requireNumber("S2S_JWKS_COOLDOWN_MS");
  const jwksTimeoutMs = requireNumber("S2S_JWKS_TIMEOUT_MS");

  const { createRemoteJWKSet } = await import("jose");
  const url = new URL(jwksUrlStr);
  const jwks = createRemoteJWKSet(url, {
    cooldownDuration: jwksCooldownMs,
    timeoutDuration: jwksTimeoutMs,
  });

  memo = {
    issuer,
    audience,
    clockSkewSec,
    jwksCooldownMs,
    jwksTimeoutMs,
    jwks,
  };
  return memo;
}

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
  // Config is validated and JWKS created on first use
  return async (req: Request, res: Response, next: NextFunction) => {
    let cfg: S2SConfig;
    try {
      cfg = await getS2SConfig();
    } catch (e: any) {
      // Misconfiguration: keep "no fallbacks" stance but don’t crash the process
      logger.error({ err: e }, "[verifyS2S] missing/invalid S2S env");
      return res
        .status(500)
        .type("application/problem+json")
        .json(
          problem(
            500,
            "Internal Server Error",
            "S2S verification not configured",
            req
          )
        );
    }

    try {
      const token = extractBearer(req);
      if (!token) {
        return res
          .status(401)
          .type("application/problem+json")
          .json(problem(401, "Unauthorized", "Missing bearer token", req));
      }

      // jose is ESM-only; import dynamically in CJS build
      const { jwtVerify } = await import("jose");

      const { payload, protectedHeader } = await jwtVerify(token, cfg.jwks, {
        algorithms: ["ES256"], // KMS key is ES256; lock it down
        issuer: cfg.issuer,
        audience: cfg.audience,
        clockTolerance: cfg.clockSkewSec,
      });

      const p = payload as Record<string, unknown>;
      (req as any).caller = {
        iss: String(p.iss || ""),
        sub: String(p.sub || "s2s"),
        aud: p.aud,
        jti: p.jti,
        svc: typeof p.svc === "string" ? p.svc : undefined,
        kid: (protectedHeader as any)?.kid,
      };

      return next();
    } catch (err: unknown) {
      // Avoid importing jose error classes just to do instanceof checks in CJS.
      // Compare by error name (stable across jose versions).
      const name = (err as any)?.name as string | undefined;

      if (name === "JWTExpired") {
        return res
          .status(401)
          .type("application/problem+json")
          .json(problem(401, "Unauthorized", "token expired", req));
      }

      if (name === "JWTClaimValidationFailed") {
        const claim = (err as any)?.claim as string | undefined;

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

      logger.debug({ err }, "[verifyS2S] verification failure");
      return res
        .status(401)
        .type("application/problem+json")
        .json(problem(401, "Unauthorized", "invalid token", req));
    }
  };
}

export default verifyS2S;
