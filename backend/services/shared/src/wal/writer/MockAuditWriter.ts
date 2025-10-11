// backend/services/shared/src/writer/MockAuditWriter.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Minimal, destination-agnostic writer that ALWAYS succeeds.
 * - Used to validate WAL ingest/flush plumbing before any real sink exists.
 *
 * Behavior:
 * - No side effects. Does not log, does not mutate inputs.
 * - Optional artificial latency via ctor option to simulate downstream delay.
 *
 * Notes:
 * - Keep this boring and reliable. All durability comes from the WAL journal.
 * - Replace with a real writer (DB/HTTP/etc.) via the writer factory when ready.
 */

import type { AuditBlob } from "../../contracts/audit/audit.blob.contract";
import type { IAuditWriter } from "./IAuditWriter";

export type MockAuditWriterOptions = {
  /** Optional artificial delay in ms to emulate downstream latency. */
  delayMs?: number;
};

export class MockAuditWriter implements IAuditWriter {
  private readonly delayMs: number;

  constructor(opts: MockAuditWriterOptions = {}) {
    this.delayMs = Math.max(0, opts.delayMs ?? 0);
  }

  public async writeBatch(_batch: ReadonlyArray<AuditBlob>): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    // Intentionally no-op; success by design.
    return;
  }
}
