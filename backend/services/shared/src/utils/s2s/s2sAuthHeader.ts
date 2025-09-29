// backend/services/shared/src/utils/s2s/s2sAuthHeader.ts
/**
 * S2S auth header builder — INTERNAL to callBySlug/httpClientBySlug
 * --------------------------------------------------------------------------
 * Purpose:
 *   Used *only* by shared S2S clients (`callBySlug`, `httpClientBySlug`)
 *   to mint and attach a KMS-signed S2S JWT on every internal hop.
 *
 * 🚫 Do NOT import or call this directly from application code.
 *    - All service-to-service calls must go through callBySlug().
 *    - Direct use outside the internal client is unsupported and will break CI.
 *
 * Rationale:
 *   Consolidates S2S identity and enforces ADR-0035 single-path policy.
 *
 * Notes:
 *   - TTL defaults to S2S_MAX_TTL_SEC (<= 900s hard cap) inside mintS2S().
 *   - This helper remains async to guarantee minting at call time.
 */

import { mintS2S } from "./mintS2S";

/**
 * Internal-only helper for callBySlug/httpClientBySlug.
 * Returns a bearer header with a freshly minted S2S JWT.
 */
export async function s2sAuthHeader(): Promise<Record<string, string>> {
  const token = await mintS2S({});
  return { Authorization: `Bearer ${token}` };
}

// Explicit default export to satisfy legacy imports inside httpClientBySlug.
// Still considered internal; not for app-level use.
export default s2sAuthHeader;
