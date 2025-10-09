adr0024-audit-wal-persistence-guarantee
# ADR-0024 — Audit WAL Persistence Guarantee (Gateway → Audit → DB)

## Status
Proposed — ready for immediate implementation (baby steps, one file at a time).

## Context
The current audit pipeline collects **begin/end** edge events at the **Gateway**, journals them via a **mandatory FS WAL**, and forwards batches to the **Audit** service, which also journals to FS and ultimately persists to the DB.

Observed problems and risks:
- **Durability gaps:** `Wal.append()` writes via `fs.appendFile` without an explicit **fsync** barrier; a process or OS crash can lose tail writes.
- **At-least-once semantics only partially upheld:** The **WalReplayer** has a durable cursor, but producer-side **Wal.flush()** can drain the in-memory queue with a no-op persist (safe for durability thanks to FS journaling, but it obscures liveness and hides back-pressure).
- **Pairing fragility:** `AuditWalFlusher` pairs begin/end **in-memory**; a restart between entries reintroduces “dangling” halves until replay reprocesses older files. There is no persisted partial map, nor DB-side idempotent assembly.
- **Config fragility:** Errors like `SvcConfig missing baseUrl for audit@1@1` stall replay and spam logs. Environment invariance requires **fail-fast** on missing/invalid endpoints and **bounded backoff** on transient upstream errors.
- **Operational clarity:** WAL cursor exists only for replay; there is no visible metric for “distance to durable DB,” making smoke failures harder to root-cause.

## Decision
Adopt a **strict persistence contract** across Gateway and Audit:
1. **Journaling is authoritative.** Every entry must be on disk with an **fsync** before being considered “accepted.”
2. **At-least-once delivery** end-to-end. Consumers (Audit/DB) must be **idempotent**.
3. **DB-side assembly** of `AuditRecord`: persist **begin** and **end** independently via deterministic upserts keyed by `{requestId}`; the first write creates the record in a **pending** state; the second transitions to **final** once both halves exist.
4. **Replay owns recovery.** Producer flush loops are best-effort. **WalReplayer** provides the durable, bounded, idempotent bridge with a **cursor** (atomic write+fsync+rename) and **exponential backoff**.
5. **Config fail-fast; transient backoff.** Missing env/config is fatal at boot. Network/5xx issues cause **bounded exponential backoff** with clear, non-spammy logs.
6. **No silent fallbacks.** All paths remain environment-agnostic and explicitly configured.

## Consequences
- **Pros**
  - Crash-safe: fsync’d journal guarantees no loss once append() returns.
  - Idempotent DB upserts remove reliance on in-memory begin/end pairing.
  - Replay is the single source of catch-up truth; operations have a cursor and backlog visibility.
  - Simpler mental model: *append → (optional flush) → replay → DB upsert.*
- **Cons**
  - Slight write latency overhead due to fsync (bounded via batched fsync cadence).
  - Additional DB upsert logic (two-phase assembly) and indexes.
  - More tunables (rotate sizes, fsync cadence, replay batch caps).

## Implementation Notes (Plan of Record)
### A. WAL (shared) — `backend/services/shared/src/wal/Wal.ts`
- [ ] Add **fsync discipline**:
  - Maintain an open file handle; `appendFs()` writes and optionally schedules an **fsync** on a short cadence (e.g., `WAL_FSYNC_MS`, default 25–50ms) to batch disk syncs.
  - On rotate and on graceful shutdown, force a final fsync.
- [ ] Ensure **atomic rotate**: create new file, write header (optional), fsync, then move pointer.
- [ ] Metrics: expose counters (appends, bytes, rotates, last fsync ts).
- [ ] Keep current behavior of mandatory FS + in-memory queue; **no** on/off switch.

### B. Replay (shared) — `backend/services/shared/src/wal/WalReplayer.ts`
- [x] Already has: atomic cursor, torn-line handling, bounded backoff.
- [ ] Add lightweight metrics hooks (batches, lines, bytes, cursor byte offset) to integrate with logger.
- [ ] Ensure **error context** (file, offset, count) is attached to thrown errors (already present).

### C. Gateway — `GatewayAuditService`
- [ ] No change to the contract emitted (continue using `AuditEntryContract`).
- [ ] Continue journaling locally and posting in batches. Failures are non-fatal thanks to Replay.
- [ ] Expose `flush()` result metrics for test harness (persisted count, exceptions).

### D. Audit Service
1. **Ingest Controller** — `/api/audit/v1/entries`
   - [ ] On receive, **append** to Audit WAL only; do **no** DB writes here.
2. **Replay Path** — `WalReplayer.onBatch`
   - [ ] Replace TODO with **repo.upsertManyFromEntries(entries)** (idempotent).
3. **Repository** — `AuditRepo`
   - [ ] Implement **deterministic upsert** keyed by `{requestId}`:
     - First half: create `{requestId, begin|end, state=pending}`.
     - Second half: set missing half, transition to `{state=final, finalizedAt}`.
     - Store normalized `target`, `status`, `http`, and any `meta` (PII stripped).  
   - [ ] Add indexes: `{requestId: 1}`, `{state: 1, finalizedAt: -1}`.
   - [ ] Upserts must be **idempotent** (same payload twice is a no-op).
4. **Wal Flusher** — `AuditWalFlusher`
   - [ ] **Delete pairing maps** (`begins`, `ends`). Pairing moves to the DB layer.
   - [ ] Replace `persistMany` call with `repo.upsertManyFromEntries`.
   - [ ] Keep timer-driven draining to reduce WAL backlog while the service is live.
5. **Readiness**
   - [ ] `readyCheck()` returns true only when DB connectivity is verified.

### E. Env & Invariance
- Required (no defaults, fail-fast if missing):
  - `WAL_DIR`, `WAL_CURSOR_FILE`, `WAL_REPLAY_BATCH_LINES`, `WAL_REPLAY_BATCH_BYTES`, `WAL_REPLAY_TICK_MS`
- Tunables (with conservative defaults for dev):
  - `WAL_FSYNC_MS` (e.g., 25–50ms fsync cadence)
  - `WAL_ROTATE_BYTES`, `WAL_ROTATE_MS`

### F. Acceptance & Smoke
- **010-direct-audit-ingest-wal-flusher.sh** turns green:
  - Inject N entries; stop Audit; verify Gateway WAL grows.
  - Start Audit; verify **Replay** drains files and DB shows **final** records for all requestIds.
- Kill -9 tests:
  - Crash Gateway after many `append()` calls → restart → Replay delivers all.
  - Crash Audit mid-replay → cursor prevents duplicates; DB upserts remain idempotent.
- Negative upstream:
  - Withhold `audit@1` URL → Replay backs off with non-spammy logs and never loses cursor.

## Alternatives Considered
1. **Keep pairing in memory** with serialized partials to disk.
   - More moving parts; still needs DB idempotency; higher complexity.
2. **Synchronous network write before fsync.**
   - Violates durability-first; risks losing records on crash.
3. **Skip WAL on Gateway (network first).**
   - Loses protection against Audit downtime; unacceptable for “can’t lose record.”

## Migration / Rollout
- Phase 1: Add fsync cadence to WAL and ship (no API changes).
- Phase 2: Move pairing into `AuditRepo.upsertManyFromEntries`; delete flusher maps.
- Phase 3: Tighten readiness to require DB ping; add replay backlog metrics.
- Phase 4: Expand smoke to include crash and backoff scenarios.

## References
- SOP (Reduced, Clean)
- ADR-0006 Gateway Edge Logging
- ADR-0022 Shared WAL & DB Base
- adr0023 Wal writer/reader split
