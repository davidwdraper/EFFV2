// backend/services/gateway/src/middleware/injectUpstreamIdentity.ts
/**
 * References:
 * - NowVibin Backend — New-Session SOP v4 (Amended)
 *   • “Only external gateway is public; gateway-core/internal workers require S2S”
 *   • “Gateway-core always re-mints outbound Authorization”
 * - Audit vs Security design split (this session):
 *   • Guardrails log SECURITY telemetry
 *   • Audit WAL logs only billable traffic, after guardrails
 *
 * Why:
 * Every upstream worker call must carry two identities:
 *   1) **S2S token**: proves the gateway itself is authorized (minted fresh per request).
 *   2) **User assertion**: conveys end-user identity to workers that need user context.
 *
 * We never forward the client’s JWT directly — that would violate trust boundaries.
 * Instead, we mint:
 *   - An S2S token using `mintS2S` (HS256 with shared secret).
 *   - A short-lived HS256 user assertion (sub, iss, aud) if the caller hasn’t already
 *     provided one in `X-NV-User-Assertion`.
 *
 * This ensures workers always see an authenticated caller (gateway) plus an asserted user.
 * The logic is fire-and-forget: if minting fails, we fail the request immediately
 * instead of sending unauthenticated traffic upstream.
 */

import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { logger } from "@shared/utils/logger";
import { mintS2S } from "@shared/svcconfig/client";

// ──────────────────────────────────────────────────────────────────────────────
// Small env helpers (no defaults: fail fast)
function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`[gateway] Missing env ${name}`);
  return String(v).trim();
}

// Required envs for user assertion minting
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

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Middleware: inject S2S Authorization + end-user assertion.
 * - Always overwrites Authorization with a fresh S2S token (gateway → worker).
 * - If X-NV-User-Assertion is missing, mints one (subject from req.user?.id if present,
 *   else from X-NV-User-Id header, else “smoke-tests” for dev/test).
 *
 * Mount this under `/api` before `serviceProxy` so all proxied calls inherit identity.
 */
export function injectUpstreamIdentity(): RequestHandler {
  return (req, _res, next) => {
    try {
      // WHY: Always inject fresh S2S; never forward client JWT directly.
      const s2s = mintS2S(300); // 5min TTL is plenty; workers revalidate per call.
      req.headers["authorization"] = `Bearer ${s2s}`;

      // WHY: Workers may need user context (ownership, auditing).
      const hasAssertion =
        !!req.headers["x-nv-user-assertion"] ||
        !!req.headers["x-user-assertion"]; // tolerate legacy header

      if (!hasAssertion) {
        // Prefer identity set by authGate, fall back to header, else benign smoke subject.
        const sub =
          (req as any)?.user?.id ||
          (req as any)?.user?.sub ||
          (req.headers["x-nv-user-id"] as string) ||
          "smoke-tests";

        const ua = mintUserAssertion(sub, 300);
        req.headers["x-nv-user-assertion"] = ua;
      }

      next();
    } catch (err) {
      // WHY: It’s safer to fail fast than proxy an unauthenticated call upstream.
      logger.error({ err }, "[gateway] injectUpstreamIdentity failed");
      next(err);
    }
  };
}

export default injectUpstreamIdentity;
