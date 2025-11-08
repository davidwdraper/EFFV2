// backend/services/shared/src/wal/IWalJournal.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Minimal, durable journaling seam for the WAL engine.
 * - Keeps the engine destination-agnostic and focused on durability.
 *
 * Design (lean, durability-first):
 * - `append()` MUST synchronously persist a single **line** to stable storage
 *   (e.g., fs append + fsync policy inside the impl). If it returns, the line
 *   is considered journaled. On failure it MUST throw (no silent fallbacks).
 * - The line format is implementation-defined (typically LDJSON).
 * - Rotation and stats are optional and can be added later without widening
 *   the core engine surface.
 *
 * Notes:
 * - No environment literals; this is an interface only.
 * - WAL implementations should never leak journal-specific metadata to callers.
 */

export interface IWalJournal {
  /**
   * Append a single serialized line to the journal and ensure it is durably
   * written according to the implementation’s fsync policy.
   * MUST throw on any failure.
   *
   * @param line A single-line serialized record (e.g., LDJSON).
   */
  append(line: string): void;

  /**
   * Optional: rotate the underlying journal file/segment.
   * Implementations may no-op. Engine should not rely on rotation semantics.
   */
  rotate?(): Promise<void>;

  /**
   * Optional: lightweight metrics for observability.
   */
  stats?(): {
    readonly bytesWritten: number;
    readonly linesWritten: number;
    readonly currentSegment?: string;
  };
}
