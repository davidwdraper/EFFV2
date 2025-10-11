// backend/services/shared/src/wal/IWalEngine.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Public, lean contract for the WAL engine.
 * - Accepts canonical `AuditBlob` and flushes via an injected writer.
 *
 * Design:
 * - Destination-agnostic: engine knows nothing about DB/HTTP/etc.
 * - Durability-first: `append*` MUST journal before returning (impl responsibility).
 * - Swappable writer: `setWriter()` lets callers change destinations at runtime.
 */

import type { AuditBlob } from "../contracts/audit/audit.blob.contract";

export interface IWalEngine {
  /**
   * Append a blob to the in-memory queue and synchronously journal it.
   * MUST throw on any journaling failure (no silent fallbacks).
   */
  append(blob: AuditBlob): void;

  /**
   * Convenience multi-append with the same durability guarantees as `append()`.
   */
  appendBatch(blobs: ReadonlyArray<AuditBlob>): void;

  /**
   * Drain queued (already journaled) blobs using the currently injected writer.
   * Concurrency: if a flush is in progress, implementations should no-op.
   * @returns `{ accepted }` — number of blobs successfully handed off.
   */
  flush(): Promise<{ accepted: number }>;

  /**
   * Swap the destination writer at runtime (e.g., new lease/config).
   */
  setWriter(next: unknown): void; // typed to avoid coupling; impl will narrow to IAuditWriter
}
