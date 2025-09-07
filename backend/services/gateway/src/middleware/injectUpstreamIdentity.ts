// backend/services/gateway/src/middleware/injectUpstreamIdentity.ts
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { logger } from "@shared/utils/logger";
import { mintS2S } from "@shared/svcconfig/client";

// Small env helpers (no defaults: fail fast)
function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`[gateway] Missing env ${name}`);
  return String(v).trim();
}

const UA_SECRET = reqEnv("USER_ASSERTION_SECRET");
const UA_ISSUER = reqEnv("USER_ASSERTION_ISSUER"); // e.g. "gateway"
const UA_AUDIENCE = reqEnv("USER_ASSERTION_AUDIENCE"); // e.g. "internal-users"

// Mint a compact HS256 end-user assertion
function mintUserAssertion(sub: string, ttlSec = 300): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub,
      iss: UA_ISSUER,
      aud: UA_AUDIENCE,
      iat: now,
      exp: now + ttlSec,
      jti: randomUUID(),
    },
    UA_SECRET,
    { algorithm: "HS256", noTimestamp: true }
  );
}

/**
 * Inject S2S Authorization + end-user assertion for upstream workers.
 * - Always overwrites Authorization with a fresh S2S token (gateway → worker).
 * - If X-NV-User-Assertion is missing, mints one (subject from req.user?.sub if present, else "smoke-tests").
 *
 * Mount this under `/api` *before* the serviceProxy.
 */
export function injectUpstreamIdentity(): RequestHandler {
  return (req, _res, next) => {
    try {
      // 1) S2S for upstream (never forward the client token directly)
      const s2s = mintS2S(300); // uses S2S_* envs in @shared/svcconfig/client
      req.headers["authorization"] = `Bearer ${s2s}`;

      // 2) End-user assertion for workers that require user context (e.g., user service)
      const hasAssertion =
        !!req.headers["x-nv-user-assertion"] ||
        !!req.headers["x-user-assertion"];

      if (!hasAssertion) {
        // Prefer identity set by authGate (if present); otherwise use a benign dev subject
        const sub =
          (req as any)?.user?.sub ||
          (req.headers["x-nv-user-id"] as string) ||
          "smoke-tests";

        const ua = mintUserAssertion(sub, 300);
        req.headers["x-nv-user-assertion"] = ua;
      }

      next();
    } catch (err) {
      logger.error({ err }, "[gateway] injectUpstreamIdentity failed");
      // Be conservative: don’t proxy without identity
      next(err);
    }
  };
}

export default injectUpstreamIdentity;
