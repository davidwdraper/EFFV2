// backend/services/jwks/src/app/JwksEnv.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/app/JwksEnv.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0034 — JWKS Service via GCP KMS, discovered by SvcFacilitator (internalOnly=true)
 *
 * Purpose:
 * - Validate and normalize all environment variables required by the jwks service.
 * - Enforces strict, fail-fast env parsing with no fallbacks or defaults.
 *
 * Invariants:
 * - All keys must be explicitly defined (no silent defaults).
 * - Mirrors legacy PoC envs:
 *     KMS_PROJECT_ID → NV_GCP_PROJECT
 *     KMS_LOCATION_ID → NV_GCP_LOCATION
 *     KMS_KEY_RING_ID → NV_GCP_KMS_KEYRING
 *     KMS_KEY_ID → NV_GCP_KMS_KEYS
 */

import { z } from "zod";

const EnvSchema = z
  .object({
    NV_JWKS_PROVIDER: z.literal("gcp-kms"),
    NV_GCP_PROJECT: z.string().min(1, "NV_GCP_PROJECT required"),
    NV_GCP_LOCATION: z.string().min(1, "NV_GCP_LOCATION required"),
    NV_GCP_KMS_KEYRING: z.string().min(1, "NV_GCP_KMS_KEYRING required"),
    NV_GCP_KMS_KEYS: z
      .string()
      .min(1, "NV_GCP_KMS_KEYS required")
      .describe("Comma-separated KMS key IDs (e.g., nowvibin-sign-rs256)"),
    NV_JWKS_KID_STRATEGY: z
      .enum(["sha256-modulus", "gcp-resource-hash"])
      .describe("Deterministic kid strategy"),
    NV_JWKS_CACHE_TTL_MS: z
      .string()
      .regex(/^\d+$/, "NV_JWKS_CACHE_TTL_MS must be numeric (milliseconds)"),
  })
  .strict();

export type JwksEnvVars = z.infer<typeof EnvSchema>;

export class JwksEnv {
  /**
   * Validate and return typed env configuration.
   * Throws immediately if any variable is missing or invalid.
   */
  static assert(): JwksEnvVars {
    return EnvSchema.parse(process.env);
  }
}
