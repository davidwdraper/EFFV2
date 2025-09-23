// backend/services/gateway/src/routes/jwks.ts

/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *
 * Why:
 * - Public JWKS endpoint (`/.well-known/jwks.json`) required by OAuth/JWT
 *   consumers to verify tokens signed by the Gateway’s **KMS-managed ES256 key**.
 * - Keeps signing key material off-disk and rotates seamlessly when KMS key
 *   versions change.
 *
 * How:
 * - On each request:
 *     1. Ensures a cached JWK is available (refreshes if older than TTL).
 *     2. Returns RFC 7517-compliant JSON Web Key Set { keys: [ {…} ] }.
 * - TTL is controlled via `JWKS_CACHE_TTL_MS` in .env.dev/.env.prod to allow
 *   tuning without redeploying.
 *
 * Security:
 * - Only returns the **public** key. No private material is ever read or stored.
 * - Errors are logged but surfaced as generic 500 to avoid leaking details.
 */

import { Router } from "express";
import type { JWK } from "jose";
import { fetchGatewayJwk } from "../services/kmsPublicKey";
import { logger } from "@eff/shared/src/utils/logger";

// Fail fast if TTL is not a valid number (per SOP: no silent fallbacks).
const JWKS_CACHE_TTL_MS_RAW = process.env.JWKS_CACHE_TTL_MS;
const JWKS_CACHE_TTL_MS = Number(JWKS_CACHE_TTL_MS_RAW);
if (
  !JWKS_CACHE_TTL_MS_RAW ||
  Number.isNaN(JWKS_CACHE_TTL_MS) ||
  JWKS_CACHE_TTL_MS < 0
) {
  throw new Error(
    "JWKS_CACHE_TTL_MS must be set to a non-negative number (in milliseconds)"
  );
}

// Our public signing key shape for JWKS consumers.
// NOTE: Key alg may be ES256 or RS256 depending on KMS key type.
// Default to ES256 to match ADR comments; fetcher can override.
type Alg = "ES256" | "RS256";
type SigJwk = JWK & { kid: string; alg: Alg; use: "sig" };

// Cache a single JWK for now (rotation can extend this to an array).
let cachedJwk: SigJwk | null = null;
let lastFetch = 0;

/**
 * Normalize whatever fetchGatewayJwk returns into a SigJwk.
 * Accepts either:
 *   - SigJwk (already complete), or
 *   - { jwk: JWK, kid: string, alg?: Alg }
 */
function toSigJwk(result: unknown): SigJwk {
  const r = result as any;

  // Case 1: already complete
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

  // Case 2: { jwk, kid, alg? }
  const jwk: JWK | undefined = r?.jwk;
  const kid: string | undefined = r?.kid ?? jwk?.kid;
  const alg: Alg = (r?.alg ?? (jwk?.alg as Alg)) || "ES256";

  if (!jwk || typeof jwk !== "object") {
    throw new Error("fetchGatewayJwk() did not return a JWK");
  }
  if (!kid) {
    throw new Error("fetchGatewayJwk() returned a JWK without a 'kid'");
  }

  // Ensure required JWKS fields are present
  const complete: SigJwk = {
    ...(jwk as object),
    kid,
    alg,
    use: "sig",
  } as SigJwk;

  return complete;
}

/**
 * Express router serving /.well-known/jwks.json
 */
export function createJwksRouter(): Router {
  const r = Router();

  r.get("/.well-known/jwks.json", async (_req, res) => {
    const now = Date.now();

    // Refresh if missing or older than TTL
    if (!cachedJwk || now - lastFetch > JWKS_CACHE_TTL_MS) {
      try {
        const raw = await fetchGatewayJwk();
        const normalized = toSigJwk(raw);
        cachedJwk = normalized;
        lastFetch = now;
        logger.info(
          { kid: normalized.kid, alg: normalized.alg, ageMs: 0 },
          "[jwks] refreshed"
        );
      } catch (err: any) {
        logger.error({ err }, "[jwks] failed to refresh");
        return res.status(500).json({
          type: "about:blank",
          title: "Internal Server Error",
          status: 500,
          detail: err?.message || "Unable to load JWKS at this time",
        });
      }
    }

    // Standard JWKS shape
    res.json({ keys: [cachedJwk] });
  });

  return r;
}

export default createJwksRouter;
