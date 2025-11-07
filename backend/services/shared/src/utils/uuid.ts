// backend/services/shared/src/utils/uuid.ts
/**
 * Docs:
 * - SOP: shared utilities; no side effects
 * - ADRs:
 *   - ADR-0057 (ID Generation & Validation — UUIDv4 only)
 *
 * Purpose:
 * - Central UUIDv4 helpers for generation & validation.
 */

import { randomUUID } from "crypto";

/**
 * Validate UUIDv4 (lower/upper case acceptable)
 */
export function isValidUuidV4(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * Generate a new RFC-4122 UUIDv4 using Node's crypto module.
 */
export function newUuid(): string {
  return randomUUID();
}
