// backend/services/shared/src/utils/s2s/mintUserAssertion.ts
/**
 * Docs:
 * - SOP:  docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0033-user-assertion-claims-expansion.md        // Contract + KMS-only user assertions
 *   - docs/adr/0030-gateway-only-kms-signing-and-jwks.md
 *   - docs/adr/0028-deprecate-gateway-core-centralize-s2s-in-shared.md
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *
 * Why:
 * - Single audited path to mint **user assertion** JWTs using **KMS (RS256)** — no .env secrets.
 * - Enforce a shared Zod contract (sub/iss/aud [+ optional nv]) before signing to prevent drift.
 * - Delegate signing to the same KMS signer used by S2S (`mintS2S`) to avoid crypto duplication.
 *
 * Policy:
 * - Required top-level claims: `sub` (userId), `iss`, `aud`.
 * - Optional vendor namespace `nv` for future metadata (kept opaque here).
 * - TTL policy sourced from env: USER_ASSERTION_TTL_SEC || TOKEN_TTL_SEC || 3600.
 *
 * Notes:
 * - `mintS2S` sets a default payload (iss/aud/sub="s2s"/iat/exp). We *override* `sub`
 *   via its `extra` field and pass the caller’s `iss`/`aud` through options.
 */

import { logger } from "../../utils/logger";
import {
  zUserAssertionClaims,
  type UserAssertionClaims,
} from "../../contracts/userAssertion.contract";
import { mintS2S } from "../../utils/s2s/mintS2S";

/** Resolve TTL for user assertions (seconds). */
function resolveTtl(): number {
  const raw =
    process.env.USER_ASSERTION_TTL_SEC ?? process.env.TOKEN_TTL_SEC ?? "3600";
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 3600;
  return Math.floor(n);
}

/**
 * Mint a KMS-signed **user assertion** JWT.
 * Accepts the full, validated claims object and delegates signing to KMS.
 *
 * @throws ZodError if claims are invalid
 * @throws Error    if the signer fails
 */
export async function mintUserAssertion(
  claims: UserAssertionClaims
): Promise<string> {
  // Validate once at the edge; never sign unchecked payloads.
  const parsed = zUserAssertionClaims.parse(claims);

  // Minimal, non-PII audit trail (do not log full payload)
  logger.debug(
    { sub: parsed.sub, iss: parsed.iss, aud: parsed.aud },
    "[shared.mintUserAssertion] mint"
  );

  // Delegate to the shared KMS signer. We override `sub` via `extra` so the
  // final token carries the end-user subject rather than "s2s".
  const token = await mintS2S({
    issuer: parsed.iss,
    audience: parsed.aud,
    ttlSec: resolveTtl(),
    extra: {
      sub: parsed.sub,
      ...(parsed.nv ? { nv: parsed.nv } : {}),
    },
  });

  if (!token || typeof token !== "string") {
    throw new Error("[shared.mintUserAssertion] signer returned no token");
  }
  return token;
}

export default mintUserAssertion;
