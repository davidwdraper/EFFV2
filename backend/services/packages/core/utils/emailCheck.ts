// backend/services/shared/src/utils/emailCheck.ts
/**
 * Docs:
 * - SOP: Single-concern, shared helpers in shared/src/utils
 * - ADR-0040 (DTO-Only Persistence; validation performed before persistence)
 * - ADR-0049 (DTO Registry & Wire Discrimination)
 *
 * Purpose:
 * - Canonical email validation helper used across all services (user, act, place, etc.).
 * - Not named "emailRegex" on purpose — future improvements (DNS, MX lookup,
 *   disallowed domains, allowlists) can be implemented without changing callers.
 *
 * Contract:
 * - `isValidEmail(email)` → boolean
 * - Callers decide whether to throw, patch, sanitize, or return errors.
 */

// A pragmatic, safe email regex — rejects garbage without RFC-complexity.
const EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

/**
 * Returns true if the given string is a valid email.
 * Performs:
 *  - trimming
 *  - basic format validation via regex
 */
export function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const email = value.trim().toLowerCase();
  if (!email) return false;

  return EMAIL_REGEX.test(email);
}

/**
 * Normalizes and returns an email OR throws with a clear reason.
 * Use this when the caller expects a guaranteed-valid email and wants
 * DTO-friendly exception semantics.
 *
 * Example:
 *   dto.email = assertValidEmail(rawInput, "UserDto.email")
 */
export function assertValidEmail(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`${context}: email must be a string.`);
  }

  const email = value.trim().toLowerCase();
  if (!email) {
    throw new Error(`${context}: email is required and cannot be blank.`);
  }

  if (!EMAIL_REGEX.test(email)) {
    throw new Error(`${context}: invalid email format: "${email}".`);
  }

  return email;
}
