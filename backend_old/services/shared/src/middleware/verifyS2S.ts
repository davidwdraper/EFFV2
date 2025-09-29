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
 *
 * Hard cap:
 * - Wrap `jwtVerify` with a local Promise.race deadline so we never exceed
 *   a small, predictable budget (e.g., 800–1200ms) even on first JWKS fetch.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";

import { requireEnv, requireNumber } from "../utils/env";
import { logger } from "../utils/logger";

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

// local deadline to bound total verify latency (including first JWKS fetch)
const VERIFY_DEADLINE_MS = Math.max(
  200,
  Math.min(Number(process.env.S2S_VERIFY_DEADLINE_MS || 900), 2000)
);

async function getS2SConfig(): Promise<S2SConfig> {
  if (memo) return memo;

  const jwksUrlStr = requireEnv("S2S_JWKS_URL");
  const issuer = requireEnv("S2S_JWT_ISSUER");
  const audience = requireEnv("S2S_JWT_AUDIENCE");
  const clockSkewSec = requireNumber("S2S_CLOCK_SKEW_SEC");

  // Safer defaults: keep JWKS fetch brief to avoid 5s hangs on cold start
  const jwksCooldownMs =
    Number(process.env.S2S_JWKS_COOLDOWN_MS || 30_000) || 30_000;
  const jwksTimeoutMs = Number(process.env.S2S_JWKS_TIMEOUT_MS || 800) || 800; // was often 5s; keep tight

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

function raceWithTimeout<T>(
  p: Promise<T>,
  ms: number,
  tag: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      // 🚨 SEARCH-REMOVE: TEMP_VERIFY_DIAG
      const e: any = new Error(`${tag}: timeout after ${ms}ms`);
      e.name = "S2SVerifyTimeout";
      e.status = 504;
      reject(e);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      }
    );
  });
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

      const verifyPromise = jwtVerify(token, cfg.jwks, {
        algorithms: ["ES256"], // KMS key is ES256; lock it down
        issuer: cfg.issuer,
        audience: cfg.audience,
        clockTolerance: cfg.clockSkewSec,
      });

      const t0 = Date.now();
      const { payload, protectedHeader } = await raceWithTimeout(
        verifyPromise,
        VERIFY_DEADLINE_MS,
        "verifyS2S"
      );
      const dt = Date.now() - t0;
      if (dt > VERIFY_DEADLINE_MS - 50) {
        logger.warn({ dt }, "[verifyS2S] verify hit deadline edge");
      }

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
    } catch (err: any) {
      const name = err?.name as string | undefined;

      if (name === "S2SVerifyTimeout") {
        // Hard, local deadline — fail fast so upstream doesn’t hang
        logger.error(
          { err: String(err?.message || err) },
          "[verifyS2S] timeout"
        );
        return res
          .status(504)
          .type("application/problem+json")
          .json(problem(504, "Gateway Timeout", "S2S verify timeout", req));
      }

      // Avoid importing jose error classes just to do instanceof checks in CJS.
      // Compare by error name (stable across jose versions).
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
