// backend/services/packages/dto/UserType.ts
/**
 * Docs:
 * - SOP: DTO-first; DTO internals never leak
 * - ADRs:
 *   - ADR-0060 (DTO Secure Access Layer)
 *
 * Purpose:
 * - Canonical user privilege levels used for DTO access control.
 *
 * Notes:
 * - Numeric ordinals are ordered from least to most privileged.
 */
export const enum UserType {
  Anon = 0,
  Viber = 1,
  PremViber = 2,
  NotUsedYet = 3,
  AdminDomain = 4,
  AdminSystem = 5,
  AdminRoot = 6,
}
