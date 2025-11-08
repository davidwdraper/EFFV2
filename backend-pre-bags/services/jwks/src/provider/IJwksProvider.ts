// backend/services/jwks/src/provider/IJwksProvider.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/provider/IJwksProvider.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0034 — JWKS Service via GCP KMS, discovered by SvcFacilitator (internalOnly=true)
 *
 * Purpose:
 * - Defines a minimal, environment-agnostic interface for JWKS providers.
 * - Each implementation must fetch and return a valid JWK Set (RFC 7517).
 *
 * Invariants:
 * - No external SDK leakage outside provider implementations.
 * - Output must pass validation via shared JwkSetSchema before returning.
 */

import type { JwkSet } from "@nv/shared/contracts/security/jwks.contract";

export interface IJwksProvider {
  /**
   * Fetches and returns an RFC 7517 compliant JWK Set.
   * Must throw on any error; never return partial data.
   */
  getJwks(): Promise<JwkSet>;
}
