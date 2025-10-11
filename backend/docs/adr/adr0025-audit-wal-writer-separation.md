// docs/architecture/backend/adr0025-audit-wal-writer-separation.md
# ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection

## Context
Past refactors let WAL logic bleed into business concerns (START/END pairing, combining, etc.). That added fragility and slowed recovery. We need a **single** WAL engine used by both **gateway** and **audit** with zero knowledge of record semantics, and a clean writer seam for destination differences.

## Decision
1. **Opaque audit payloads.** The WAL engine stores/drains **opaque blobs**. It never inspects START/END/whatever.
2. **Write-through semantics.** Every drained record is written to the destination as-is. **No combining, no pairing.**
3. **FIFO analytics store in Audit DB.** The primary audit store has **no indexes** (beyond the DB’s implicit PK). It’s a FIFO landing zone later drained to the analytics DB/warehouse.
4. **Shared WAL with injected writer.** Gateway and Audit use the **same** WAL engine. Destination differs via an injected `IAuditWriter`:
   - **Gateway:** writer → `svcClient` → Audit service ingest route.
   - **Audit:** writer → direct DB insert.
   Both implement the **same** `IAuditWriter`.

## Architecture (final form)
- **Shared**
  - `IAuditWriter` — sink contract for drained records.
  - `WalEngine` — append + flush + fsync cadence + replay; knows files, **not** schemas.
  - `WalReplayer` — pluggable strategy to rescan journals and push to writer.
  - `AuditBlob` — the opaque payload envelope (typed for transport only).
- **Gateway**
  - `HttpAuditWriter` (IAuditWriter) → `ISvcClient.call()` to Audit `/entries`.
- **Audit**
  - `DbAuditWriter` (IAuditWriter) → single unindexed collection/ table (FIFO).

## Canonical Interfaces (shapes, not implementations)
```ts
// shared/audit/IAuditWriter.ts
export interface IAuditWriter {
  /** Write a single opaque record onward (HTTP→Audit or DB insert). Must be idempotent or tolerate replay. */
  write(record: AuditBlob): Promise<void>;

  /** Optional batch write; default impl loops write(). */
  writeBatch?(batch: AuditBlob[]): Promise<void>;
}

// shared/audit/AuditBlob.ts
export type AuditBlob = {
  ts: number;                 // epoch ms
  requestId: string;          // propagated
  producer: string;           // service slug (e.g., "gateway")
  phase?: string;             // opaque metadata from caller; WAL never branches on this
  payload: unknown;           // fully opaque; redacted upstream per policy
  meta?: Record<string, unknown>;  // optional
};

// shared/audit/IWalJournal.ts (internal seam used by WalEngine)
export interface IWalJournal {
  append(line: string): void;                          // sync write to LDJSON journal
  fsyncMaybe(nowMs: number): void;                     // cadence-based fsync (ADR-0024)
  readBatches(cb: (batch: string[]) => Promise<void>): Promise<void>; // for replay
}

// shared/audit/WalEngine.ts (public engine)
export interface IWalEngine {
  append(blob: AuditBlob): void; // enqueue + journal append (sync)
  flush(): Promise<void>;        // drain in FIFO to writer (async; respects WAL_BATCH_MAX)
  replayer(): IWalReplayer;      // strategy seam (cursorless default)
}

// shared/audit/IWalReplayer.ts
export interface IWalReplayer {
  replay(onBatch: (batch: AuditBlob[]) => Promise<void>): Promise<{ files: number; lines: number }>;
}
```

## Storage Model (Audit DB — FIFO landing zone)
- **Collection/Table:** `audit_fifo`
- **Schema (minimal):** `{ _id, ts, requestId, producer, payload, meta }`
- **Indexes:** none (beyond implicit PK). This is deliberate for cheap writes and simple replay idempotency logic at the warehouse phase.

## Operational Dials (env; enforced via IEnv)
- `WAL_DIR` (required) — writable directory for LDJSON journals
- `WAL_BATCH_MAX` (default 100)
- `WAL_FLUSH_MS` (default 1000)
- `WAL_FSYNC_MS` (default 250)
- `WAL_REPLAY_MS` (default 2000)

## Failure & Recovery
- **Journal append fails:** fail-fast the caller (do not accept a request you can’t audit).
- **Destination down:** `flush()` backs off with jitter; records stay journaled.
- **Crash mid-batch:** replay re-reads; writers must tolerate dupes (idempotent at destination or harmless duplicates for FIFO).
- **Disk pressure:** if `WAL_DIR` unwritable/full → service refuses audited work (backpressure is explicit).

## Security & Privacy
- Redaction happens **before** `append()`. WAL stores only redacted payloads.
- No secrets in `payload`; sensitive data must be tokenized upstream.

## Consequences
- Simplifies engine: opaque, durable, and shared.
- Moves all “meaning” (START/END/… pairing) to **downstream analytics**, not runtime.
- Replay behavior is deterministic and testable; engine never “interprets.”

## Implementation Notes (baby steps)
1. Add shared contracts (`AuditBlob`, `IAuditWriter`, `IWalEngine`, `IWalReplayer`).
2. Implement `WalEngine` with cursor-less `WalReplayer` (default).
3. Provide two writers:
   - `HttpAuditWriter` (gateway) → `ISvcClient` POST `/api/audit/v1/entries`.
   - `DbAuditWriter` (audit) → direct insert into `audit_fifo`.
4. Wire intervals in `ServiceEntrypoint`: `flush()` and `replay()` timers.
5. Smoke tests:
   - Gateway produces N audit blobs → Audit receives N rows.
   - Kill Audit; produce M → restart → replay restores M.
   - fsync cadence bounded loss sim (ADR-0024).

## Alternatives Considered
- WAL interpreting START/END and combining — **rejected** (couples engine to semantics; brittle).
- Indexed operational store — **rejected** (write cost and shape churn; analytics owns structure).

## References
- ADR-0022 — Shared WAL & DB Base
- ADR-0024 — Audit WAL Persistence Guarantee (fsync cadence)
- SOP — Environment Invariance, “No Silent Fallbacks,” One Public Door (Gateway)
