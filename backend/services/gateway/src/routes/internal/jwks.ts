// backend/services/gateway/src/routes/internal/jwks.ts
/**
 * NowVibin — Gateway (Internal)
 *
 * Purpose:
 * - INTERNAL S2S JWKS endpoint (mounted by caller at /.well-known/jwks.json).
 * - Router responds at "/" so it can be mounted cleanly.
 *
 * Notes:
 * - Keep this router PUBLIC on the internal plane (mounted before verifyS2S).
 *   Otherwise jose can’t fetch keys to verify the very token required to fetch keys.
 */

import { Router, type Router as ExpressRouter } from "express";
import type { JWK } from "jose";
import { logger } from "@eff/shared/src/utils/logger";
import { requireNumber } from "@eff/shared/src/env";
import { fetchGatewayJwk } from "../../services/kmsPublicKey";

type Alg = "ES256" | "RS256";
type SigJwk = JWK & { kid: string; alg: Alg; use: "sig" };

const JWKS_CACHE_TTL_MS = requireNumber("JWKS_CACHE_TTL_MS");

let cachedJwk: SigJwk | null = null;
let lastFetch = 0;

function toSigJwk(result: unknown): SigJwk {
  const r = result as any;
  if (
    r &&
    typeof r === "object" &&
    r.kid &&
    r.use === "sig" &&
    r.alg &&
    r.kty
  ) {
    return r as SigJwk;
  }
  const jwk: JWK | undefined = r?.jwk;
  const kid: string | undefined = r?.kid ?? jwk?.kid;
  const alg: Alg = (r?.alg ?? (jwk?.alg as Alg)) || "ES256";
  if (!jwk || typeof jwk !== "object")
    throw new Error("fetchGatewayJwk() did not return a JWK");
  if (!kid) throw new Error("fetchGatewayJwk() returned a JWK without a 'kid'");
  return { ...(jwk as object), kid, alg, use: "sig" } as SigJwk;
}

const router: ExpressRouter = Router();

// NOTE: respond at "/" — the caller mounts us at "/.well-known/jwks.json"
router.get("/", async (_req, res) => {
  const now = Date.now();

  if (!cachedJwk || now - lastFetch > JWKS_CACHE_TTL_MS) {
    try {
      const raw = await fetchGatewayJwk();
      const normalized = toSigJwk(raw);
      cachedJwk = normalized;
      lastFetch = now;
      logger.info(
        { kid: normalized.kid, alg: normalized.alg },
        "[jwks] refreshed (internal)"
      );
    } catch (err: any) {
      logger.error({ err }, "[jwks] refresh failed (internal)");
      return res.status(500).json({
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: err?.message || "Unable to load JWKS at this time",
      });
    }
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({ keys: [cachedJwk] });
});

export default router;
