// backend/services/shared/src/id/IdFactory.ts
/**
 * Docs:
 * - ADRs:
 *   - ADR-0049 (Canonical string IDs)
 *
 * Purpose:
 * - Central place to mint canonical IDs (UUID v7 preferred; falls back safely).
 */

import crypto from "crypto";

/** Generate a roughly time-ordered UUID (v7 when available; fallback otherwise). */
export function newId(): string {
  // Node 18+ has randomUUID, but not v7 yet. Use v4 + time prefix for locality.
  if (typeof (crypto as any).randomUUID === "function") {
    // Prefix with millisecond time to improve index locality without breaking uniqueness.
    const t = Date.now().toString(16).padStart(12, "0");
    const rnd = (crypto as any).randomUUID().replace(/-/g, "");
    // 12 hex time + 20 hex random → 32 hex chars total
    return `${t}${rnd.slice(0, 20)}`;
  }
  // Fallback: time + random bytes (no dashes)
  const t = Date.now().toString(16).padStart(12, "0");
  const rnd = crypto.randomBytes(10).toString("hex"); // 20 hex
  return `${t}${rnd}`;
}
