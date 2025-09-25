// backend/services/shared/tenant/bucket.ts
import { requireNumber } from "@eff/shared/src/env";
import { createHash } from "crypto";

// No magic numbers. Fail fast if USER_BUCKETS is missing/invalid.
export const USER_BUCKETS: number = (() => {
  const n = requireNumber("USER_BUCKETS");
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Env USER_BUCKETS must be a positive integer, got: ${n}`);
  }
  return n;
})();

export function normalizeEmail(e: string): string {
  return String(e ?? "")
    .trim()
    .toLowerCase();
}

export function emailToBucket(email: string, buckets = USER_BUCKETS): number {
  if (!Number.isInteger(buckets) || buckets <= 0) {
    throw new Error(`buckets must be a positive integer, got: ${buckets}`);
  }
  const hex = createHash("sha1").update(normalizeEmail(email)).digest("hex");
  const n = parseInt(hex.slice(0, 8), 16) >>> 0; // unsigned 32-bit
  return n % buckets;
}
