// backend/services/jwks/src/env/JwksEnv.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/env/JwksEnv.ts
 *
 * Docs / Invariants:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0017 — JWKS Service carve-out (policy/public route)
 * - ADR-0035 — JWKS via GCP KMS with TTL Cache
 *
 * Purpose:
 * - Validate and return strongly-typed env for the JWKS service.
 * - Fail fast on missing/invalid values. Ignore unrelated process.env noise.
 *
 * Notes:
 * - We **whitelist** only the keys we own, then run a strict Zod parse.
 * - No defaults, no fallbacks. Dev == Prod; only values differ.
 */

import { z } from "zod";
import {
  RsaAlgSchema,
  EcAlgSchema,
} from "@nv/shared/contracts/security/jwks.contract";

const JwtAlgSchema = z.union([RsaAlgSchema, EcAlgSchema]);

export const EnvSchema = z
  .object({
    // --- Google Cloud KMS coordinates (all required) ---
    KMS_PROJECT_ID: z.string().min(1, "KMS_PROJECT_ID required"),
    KMS_LOCATION_ID: z.string().min(1, "KMS_LOCATION_ID required"), // e.g., "us" or "us-central1"
    KMS_KEY_RING_ID: z.string().min(1, "KMS_KEY_RING_ID required"),
    KMS_KEY_ID: z.string().min(1, "KMS_KEY_ID required"),
    // Explicit version in v1 for deterministic kid
    KMS_KEY_VERSION: z.string().min(1, "KMS_KEY_VERSION required"),

    // JWT alg we advertise; must match key type
    KMS_JWT_ALG: JwtAlgSchema,

    // TTL in milliseconds for the in-memory JWKS cache
    NV_JWKS_CACHE_TTL_MS: z.coerce
      .number()
      .int()
      .positive("NV_JWKS_CACHE_TTL_MS must be a positive integer"),

    // Optional — ADC will be used if unset
    GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
  })
  .strict();

export type JwksEnvValues = z.infer<typeof EnvSchema>;

/** Pick only known keys from process.env to avoid strict() rejecting unrelated envs. */
function pickEnv(
  keys: readonly (keyof JwksEnvValues)[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = process.env[k as string];
  return out;
}

const REQUIRED_KEYS = [
  "KMS_PROJECT_ID",
  "KMS_LOCATION_ID",
  "KMS_KEY_RING_ID",
  "KMS_KEY_ID",
  "KMS_KEY_VERSION",
  "KMS_JWT_ALG",
  "NV_JWKS_CACHE_TTL_MS",
  // optional:
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

export class JwksEnv {
  /**
   * Validate and return typed env configuration.
   * Throws immediately if any required variable is missing/invalid.
   */
  static assert(): JwksEnvValues {
    const subset = pickEnv(REQUIRED_KEYS);
    return EnvSchema.parse(subset);
  }
}
