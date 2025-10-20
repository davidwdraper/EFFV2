// backend/services/shared/src/contracts/security/jwks.contract.ts
/**
 * Docs / Invariants:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0034 — JWKS Service via GCP KMS, discovered by SvcFacilitator (internalOnly=true)
 *
 * Purpose:
 * - Canonical Zod schemas for the **public** JWK objects we publish and the top-level JWK Set.
 * - These contracts gate what we emit on `/api/jwks/v1/keys` to avoid malformed or drifting shapes.
 *
 * Notes:
 * - Strict schemas: unknown fields are rejected to keep outputs predictable/auditable.
 * - Supported public keys: **RSA** and **EC** (P-256/P-384/P-521). (OK to extend later with a formal ADR.)
 * - This file defines shape only. Conversion (PEM/DER → JWK) lives in shared/security helpers.
 */

import { z } from "zod";

/** Common enumerations kept small and explicit to prevent drift. */
export const JwkUseSchema = z.enum(["sig"]).describe("Intended use of the key");
export type JwkUse = z.infer<typeof JwkUseSchema>;

export const RsaAlgSchema = z.enum([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
]);
export type RsaAlg = z.infer<typeof RsaAlgSchema>;

export const EcAlgSchema = z.enum(["ES256", "ES384", "ES512"]);
export type EcAlg = z.infer<typeof EcAlgSchema>;

export const EcCrvSchema = z.enum(["P-256", "P-384", "P-521"]);
export type EcCrv = z.infer<typeof EcCrvSchema>;

/** Base fields shared across all published JWKs. */
const JwkBaseStrict = z
  .object({
    kty: z.enum(["RSA", "EC"]),
    kid: z.string().min(1, "kid required"),
    use: JwkUseSchema.optional(), // typically 'sig'
    alg: z.string().min(1).optional(), // constrained by subtype below
    // Optional X.509 certificate chain. Left optional for future pinning strategies.
    x5c: z.array(z.string()).nonempty().optional(),
  })
  .strict();

/** RFC 7517 RSA public JWK (strict subset we emit). */
export const RsaPublicJwkSchema = JwkBaseStrict.extend({
  kty: z.literal("RSA"),
  alg: RsaAlgSchema.optional(),
  n: z.string().min(1, "RSA modulus (n) required"),
  e: z.string().min(1, "RSA exponent (e) required"),
}).strict();

export type RsaPublicJwk = z.infer<typeof RsaPublicJwkSchema>;

/** RFC 7517 EC public JWK (strict subset we emit). */
export const EcPublicJwkSchema = JwkBaseStrict.extend({
  kty: z.literal("EC"),
  alg: EcAlgSchema.optional(),
  crv: EcCrvSchema,
  x: z.string().min(1, "EC x coordinate required"),
  y: z.string().min(1, "EC y coordinate required"),
}).strict();

export type EcPublicJwk = z.infer<typeof EcPublicJwkSchema>;

/** Union of all supported public JWK variants. */
export const JwkSchema = z.union([RsaPublicJwkSchema, EcPublicJwkSchema]);
export type Jwk = z.infer<typeof JwkSchema>;

/** Top-level JWK Set (RFC 7517) — strict, predictable ordering not enforced. */
export const JwkSetSchema = z
  .object({
    keys: z.array(JwkSchema).min(1, "At least one JWK is required"),
  })
  .strict();

export type JwkSet = z.infer<typeof JwkSetSchema>;

/** Helper: validate and return a typed JWK Set (throws ZodError on failure). */
export function assertJwkSet(input: unknown): JwkSet {
  return JwkSetSchema.parse(input);
}

/** Helper: narrow a single JWK (throws ZodError on failure). */
export function assertJwk(input: unknown): Jwk {
  return JwkSchema.parse(input);
}
