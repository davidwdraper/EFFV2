// backend/services/shared/src/security/ValidatePassword.ts
/**
 * Docs:
 * - SOP: Secrets are never logged; validation emits only metadata (e.g., length).
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0063 (Auth Signup MOS Pipeline)
 *
 * Purpose:
 * - Centralize basic password validation so auth/signup handlers can call a
 *   single helper and policy can evolve in one place.
 *
 * Contract:
 * - ValidatePassword(password: string): boolean
 *   • true  => password meets current policy
 *   • false => password fails current policy
 *
 * Notes:
 * - This helper MUST NOT log or throw. Callers decide how to surface failures.
 * - Policy can expand over time (e.g., character classes); callers treat
 *   boolean=false as "password rejected", not as a specific reason.
 */

const MIN_LEN = 8;
const MAX_LEN = 256;

export function ValidatePassword(password: string): boolean {
  if (typeof password !== "string") return false;

  const trimmed = password.trim();
  const len = trimmed.length;

  if (len < MIN_LEN || len > MAX_LEN) {
    return false;
  }

  // Future policy hooks:
  // - require digit, uppercase, symbol, etc.
  // For now we keep it minimal and length-based.
  return true;
}
