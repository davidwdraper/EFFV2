// backend/services/gateway/src/middleware/injectUpstreamIdentity.ts

/**
 * Docs:
 * - ADRs:
 *   - docs/adr/0023-use-jose-for-gateway-user-assertion-minting-hs256.md
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 * - SOP: docs/architecture/backend/SOP.md
 *
 * Why:
 * - jose is ESM-only. Gateway compiles to CommonJS. We lazily dynamic-import
 *   jose at runtime so ts-node-dev and CJS builds work cleanly.
 * - Trust boundary: never forward client JWT upstream; always inject fresh S2S
 *   and mint a short-lived user assertion when missing.
 *
 * Notes:
 * - Fail fast on missing USER_ASSERTION_* envs.
 * - Async minting; never blocks beyond the minimal crypto call.
 */

import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { logger } from "@eff/shared/src/utils/logger";
import { mintS2S } from "@eff/shared/src/svcconfig/client";

// ── ESM jose bridge (lazy) ───────────────────────────────────────────────────
type JoseMod = typeof import("jose");
let _jose: JoseMod | null = null;
async function jose(): Promise<JoseMod> {
  if (_jose) return _jose;
  _jose = await import("jose"); // ESM-only; dynamic import works under CJS
  return _jose;
}

// ── Env helpers (fail fast; no silent fallbacks) ─────────────────────────────
function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`[gateway] Missing env ${name}`);
  return String(v).trim();
}

const UA_SECRET_BYTES = new TextEncoder().encode(
  reqEnv("USER_ASSERTION_SECRET")
);
const UA_ISSUER = reqEnv("USER_ASSERTION_ISSUER");
const UA_AUDIENCE = reqEnv("USER_ASSERTION_AUDIENCE");

// ── User assertion (HS256) ───────────────────────────────────────────────────
async function mintUserAssertion(sub: string, ttlSec = 300): Promise<string> {
  const { SignJWT } = await jose();
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSec)
    .setIssuer(UA_ISSUER)
    .setAudience(UA_AUDIENCE)
    .setJti(randomUUID())
    .sign(UA_SECRET_BYTES);
}

/**
 * Middleware: inject S2S Authorization + end-user assertion.
 * - Always overwrites Authorization with a fresh S2S token (gateway → worker).
 * - If X-NV-User-Assertion is missing, mints one (subject from req.user?.id if present,
 *   else from X-NV-User-Id header, else “smoke-tests”).
 */
export function injectUpstreamIdentity(): RequestHandler {
  return async (req, _res, next) => {
    try {
      // Always inject fresh S2S; never forward client auth upstream.
      const ttlSec = Math.min(
        Number(process.env.S2S_MAX_TTL_SEC || 300) || 300,
        900
      );
      const s2s = mintS2S(ttlSec);
      req.headers["authorization"] = `Bearer ${s2s}`;

      // User assertion (only if caller didn't provide one)
      const hasAssertion =
        !!req.headers["x-nv-user-assertion"] ||
        !!req.headers["x-user-assertion"]; // tolerate legacy header

      if (!hasAssertion) {
        const sub =
          (req as any)?.user?.id ||
          (req as any)?.user?.sub ||
          (req.headers["x-nv-user-id"] as string) ||
          "smoke-tests";

        req.headers["x-nv-user-assertion"] = await mintUserAssertion(sub, 300);
      }

      next();
    } catch (err) {
      // Safer to fail than to proxy unauthenticated traffic upstream.
      logger.error({ err }, "[gateway] injectUpstreamIdentity failed");
      next(err);
    }
  };
}

export default injectUpstreamIdentity;
