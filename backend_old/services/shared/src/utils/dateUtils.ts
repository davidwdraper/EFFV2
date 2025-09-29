// shared/utils/dateUtils.ts

/**
 * Returns the current date as an ISO string.
 * Example: "2025-08-01T17:30:00.000Z"
 */
export function dateNowIso(): string {
  return new Date().toISOString();
}

/**
 * Returns a new Date object in UTC (useful if you need to store Date instances).
 */
export function dateNowUtc(): Date {
  return new Date(); // JS Date is UTC by default
}
