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
export function isValidUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * Generate a new RFC-4122 UUIDv4 using Node's crypto module.
 * Normalized to lowercase for stability.
 */
export function newUuid(): string {
  return randomUUID().toLowerCase();
}

/**
 * Canonical UUIDv4 validator/normalizer for DTO ids.
 * - Trims whitespace
 * - Ensures value is a UUIDv4
 * - Returns lowercase UUID string
 * - Throws with Ops guidance on invalid input
 */
export function validateUUIDString(value: string): string {
  const trimmed = (value ?? "").trim();

  if (!isValidUuid(trimmed)) {
    throw new Error(
      `INVALID_UUID_V4: "${value}" is not a valid UUIDv4 string. ` +
        `Ops: ensure callers mint ids via newUuid() or provide valid UUIDv4 ` +
        `values from trusted sources; inspect upstream payloads and DTO contracts.`
    );
  }

  return trimmed.toLowerCase();
}
