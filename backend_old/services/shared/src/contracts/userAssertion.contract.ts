// backend/services/shared/src/contracts/userAssertion.contract.ts
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
 * - Single source of truth for **user assertion JWT** claims used by mintUserAssertion.
 * - Strict, audit-friendly schema: minimal required top-level, optional vendor namespace.
 *
 * Policy:
 * - Required: sub (userId), iss (issuer), aud (audience).
 * - Optional: iat/exp (normally set by signer), nv (namespaced metadata).
 */

import { z } from "zod";

export const zUserAssertionClaims = z.object({
  sub: z.string().min(1), // subject = userId (never email/PII)
  iss: z.string().min(1), // issuer (e.g., "gateway" | "auth")
  aud: z.string().min(1), // audience (e.g., "internal-services"),
  iat: z.number().int().optional(),
  exp: z.number().int().optional(),
  // Vendor namespace for future metadata (opaque to validators).
  // Note: some Zod versions require both key and value types for record().
  nv: z.record(z.string(), z.unknown()).optional(),
});

export type UserAssertionClaims = z.infer<typeof zUserAssertionClaims>;
