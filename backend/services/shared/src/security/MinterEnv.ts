// backend/services/shared/src/security/MinterEnv.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0036 — Token Minter using GCP KMS Sign
 * - ADR-0035 — JWKS Service for Public Keys (kid/alg alignment)
 *
 * Purpose (single concern):
 * - Validate and expose the exact environment required for JWT signing.
 *
 * Why:
 * - No literals, no defaults, no fallbacks. Fail-fast at boot if anything is missing.
 * - Keeps signer/minter logic free of ad-hoc env probing.
 */

import { z } from "zod";

/** Strict schema — every field required, no defaults. */
const EnvSchema = z
  .object({
    KMS_PROJECT_ID: z.string().min(1),
    KMS_LOCATION_ID: z.string().min(1),
    KMS_KEY_RING_ID: z.string().min(1),
    KMS_KEY_ID: z.string().min(1),
    KMS_KEY_VERSION: z.string().min(1),
    /** JWS alg to advertise in header; must match KMS key type (e.g., "RS256"). */
    KMS_JWT_ALG: z.enum(["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"]),
    /** Global issuer for S2S; enforced by secureS2S and used by minter unless caller overrides. */
    NV_ISSUER: z.string().min(1),
  })
  .strict();

export type MinterEnvShape = z.infer<typeof EnvSchema>;

export class MinterEnv {
  /**
   * Validate and return typed env configuration.
   * Throws immediately if any variable is missing or invalid.
   */
  static assert(env: NodeJS.ProcessEnv = process.env): MinterEnvShape {
    // Parse **only** known keys; reject extras to surface drift.
    return EnvSchema.parse({
      KMS_PROJECT_ID: env.KMS_PROJECT_ID,
      KMS_LOCATION_ID: env.KMS_LOCATION_ID,
      KMS_KEY_RING_ID: env.KMS_KEY_RING_ID,
      KMS_KEY_ID: env.KMS_KEY_ID,
      KMS_KEY_VERSION: env.KMS_KEY_VERSION,
      KMS_JWT_ALG: env.KMS_JWT_ALG,
      NV_ISSUER: env.NV_ISSUER,
    });
  }
}
