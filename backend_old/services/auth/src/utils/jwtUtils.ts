// backend/services/auth/src/utils/jwtUtils.ts
/**
 * Docs:
 * - SOP:  docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0033-user-assertion-claims-expansion.md        // KMS-only user JWTs; strict claims
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *
 * Why:
 * - Mint **user-facing** JWTs using the shared KMS signer (no .env secrets).
 * - Keep top-level claims minimal (`sub`, `iss`, `aud`) to satisfy strict contract.
 * - Profile data is returned alongside the token in JSON (not embedded in JWT).
 *
 * Notes:
 * - `generateToken` is async; callers must `await`.
 * - Required env (non-secret): S2S_JWT_ISSUER, S2S_JWT_AUDIENCE.
 * - TTL policy is resolved inside shared `mintUserAssertion` (env-driven).
 */

import { logger } from "@eff/shared/src/utils/logger";
import { mintUserAssertion } from "@eff/shared/src/utils/s2s/mintUserAssertion";

const ISSUER =
  process.env.S2S_JWT_ISSUER ||
  (() => {
    throw new Error("S2S_JWT_ISSUER is required for user JWT minting");
  })();

const AUDIENCE =
  process.env.S2S_JWT_AUDIENCE ||
  (() => {
    throw new Error("S2S_JWT_AUDIENCE is required for user JWT minting");
  })();

type PublicProfile = {
  id: string; // required for sub
  email: string; // returned in response body (not inside token)
  firstname?: string; // returned in response body
  middlename?: string; // returned in response body
  lastname?: string; // returned in response body
};

/**
 * Mint a KMS-signed user JWT with strict, minimal claims.
 * Top-level claims only: sub/iss/aud.
 */
export async function generateToken(profile: PublicProfile): Promise<string> {
  logger.debug(
    { hasId: !!profile.id },
    "[auth.jwtUtils] mint user token (KMS, minimal claims)"
  );

  // Single-argument call; TTL handled inside mintUserAssertion (env-driven).
  const token = await mintUserAssertion({
    sub: profile.id,
    iss: ISSUER,
    aud: AUDIENCE,
  });

  return token;
}
