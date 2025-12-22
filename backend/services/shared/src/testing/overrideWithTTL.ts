// backend/services/shared/src/testing/overrideWithTTL.ts
/**
 * Docs:
 * - ADR-0044 (EnvServiceDto — Key/Value Contract) [consumer example]
 * - ADR-0074 (DB_STATE-aware DB selection via getDbVar) [context only]
 *
 * Purpose:
 * - Provide a small, generic helper for temporarily overriding a value
 *   (env var, flag, etc.) with:
 *     • manual restore (primary safety),
 *     • TTL-based auto-restore (last-resort safety).
 *
 * Invariants:
 * - Timers live here, not in DTOs or handlers.
 * - Callers MUST always call restore() in a finally block.
 * - TTL is only a backup in case finally never runs.
 */

/**
 * Temporarily override a value.
 *
 * - set(temp) is called immediately.
 * - After ttlMs, original is restored automatically if restore() was never called.
 * - restore() cancels the timer and restores original immediately; safe to call multiple times.
 */
export function overrideWithTTL<T>(
  set: (v: T) => void,
  original: T,
  temp: T,
  ttlMs: number
): () => void {
  let active = true;

  // apply override right away
  set(temp);

  const timer = setTimeout(() => {
    if (!active) return;
    set(original);
    active = false;
  }, ttlMs);

  return () => {
    if (!active) return;
    clearTimeout(timer);
    set(original);
    active = false;
  };
}
