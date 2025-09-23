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
import { fetchGatewayJwk } from "../services/kmsPublicKey";
import { logger } from "@eff/shared/src/utils/logger";

// No default/fallbacks: env must be defined or the service will fail fast on boot.
const JWKS_CACHE_TTL_MS = Number(process.env.JWKS_CACHE_TTL_MS);

let cachedJwk: Record<string, unknown> | null = null;
let lastFetch = 0;

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
        cachedJwk = await fetchGatewayJwk();
        lastFetch = now;
        logger.info(
          { kid: cachedJwk.kid, ageMs: now - lastFetch },
          "[jwks] refreshed"
        );
      } catch (err) {
        logger.error({ err }, "[jwks] failed to refresh");
        return res.status(500).json({
          type: "about:blank",
          title: "Internal Server Error",
          status: 500,
          detail: "Unable to load JWKS at this time",
        });
      }
    }

    // Standard JWKS shape
    res.json({ keys: [cachedJwk] });
  });

  return r;
}
