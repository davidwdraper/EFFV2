# ADR-0023 — Split WAL writer/flush and WAL replay into distinct classes

## Context
We have a working `Wal` that performs **durable append** (LDJSON) and **live in-memory flush** to a caller-provided persistence function.  
What’s missing is **crash/restart resilience**: replay of previously written LDJSON files with a **durable cursor** so services can catch up after outages — whether the **Audit DB**, **Audit service**, or **Gateway → Audit path** goes down temporarily.

Constraints from the SOP:
- **Env invariance** — no literals, dev == prod; fail-fast if envs missing.
- **OO / SRP** design — single-concern classes, dependency-injected.
- **No barrels or shims.**
- **One instance per process** for all shared infra classes.

---

## Decision
Keep the existing `Wal` focused solely on **append + live queue flush**.  
Introduce a new shared class **`WalReplayer`**, responsible for **file replay with a durable cursor**.

### `Wal` (unchanged)
- `append(record)` → synchronous LDJSON write + in-memory queue push.
- `flush(persist)` drains the in-memory queue only.
- Handles rotation by size/time → monotonic filenames `wal-<epoch>.ldjson`.
- **No disk reading**, **no cursor**, **no replay** logic.

### `WalReplayer` (new, shared)
- Scans `WAL_DIR` for `wal-*.ldjson` (sorted lexicographically).
- Tracks durable cursor `{ file, offset }` → `WAL_CURSOR_FILE`.
- Reads up to `batchLines` / `batchBytes` from `{ file, offset }`.
- Buffers **partial/torn lines** until newline.
- Calls `onBatch(lines)`; **advances cursor only after success** (atomic write → fsync → rename).
- Provides `start()`, `stop()`, `tickOnce()` (for test).

### Composition per Service
- **Gateway:** `Wal` for append; `WalReplayer` replays to Audit via `SvcClient` when Audit unavailable.
- **Audit:** `Wal` for append; `WalReplayer` replays to DB after DB outage or restart.

Idempotency and dedupe are enforced **at the DB boundary** (Audit), not in WAL itself.

---

## Consequences
- **SRP & Testability:** clean separation between writer and reader.  
- **Resilience:** at-least-once delivery from disk; duplicates absorbed by DB `upsert`.  
- **Operational Transparency:** simple metrics/logs (`replay_started`, `replay_batch_ok`, `cursor_advanced`, etc.).

Trade-offs:
- Slightly more DI wiring in each service.
- Requires deterministic DB key for idempotency.

---

## Implementation Notes

**New file (shared):**
```
backend/services/shared/src/wal/WalReplayer.ts
```
_No barrels; include path header + ADR refs._

### Constructor
```ts
{
  walDir: string;
  cursorPath: string;
  batchLines?: number;
  batchBytes?: number;
  tickMs?: number;
  logger: ILogger;
  onBatch: (lines: string[]) => Promise<void>;
}
```

### Cursor durability
- Write temp file → `fsync` → atomic rename to `WAL_CURSOR_FILE`.

### Env (fail-fast)
| Env Var | Purpose |
|----------|----------|
| `WAL_DIR` | Base directory for WAL files |
| `WAL_CURSOR_FILE` | Durable replay cursor file |
| `WAL_REPLAY_BATCH_LINES` | Max lines per batch (default 2000) |
| `WAL_REPLAY_BATCH_BYTES` | Max bytes per batch (default 1MB) |
| `WAL_REPLAY_TICK_MS` | Replay loop delay (default 200ms) |
| `AUDIT_SLUG` | Gateway-only: target Audit service slug |

---

### Gateway Wiring
On app start (after logger/env validation):
```ts
const replayer = new WalReplayer({
  walDir: mustEnv("WAL_DIR"),
  cursorPath: mustEnv("WAL_CURSOR_FILE"),
  batchLines: intEnv("WAL_REPLAY_BATCH_LINES"),
  batchBytes: intEnv("WAL_REPLAY_BATCH_BYTES"),
  tickMs: intEnv("WAL_REPLAY_TICK_MS"),
  logger: log,
  onBatch: async (lines) => {
    const payload = lines.map(JSON.parse);
    await svcClient.postBySlug(mustEnv("AUDIT_SLUG"), "/entries", { entries: payload });
  },
});
replayer.start();
this.onShutdown(() => replayer.stop());
```

---

### Audit Wiring
On app start:
```ts
const replayer = new WalReplayer({
  walDir: mustEnv("WAL_DIR"),
  cursorPath: mustEnv("WAL_CURSOR_FILE"),
  batchLines: intEnv("WAL_REPLAY_BATCH_LINES"),
  batchBytes: intEnv("WAL_REPLAY_BATCH_BYTES"),
  tickMs: intEnv("WAL_REPLAY_TICK_MS"),
  logger: log,
  onBatch: async (lines) => {
    const entries = lines.map(JSON.parse);
    const records = pairEntriesToRecords(entries);
    await auditRepo.persistMany(records); // upsert on deterministic key
  },
});
replayer.start();
this.onShutdown(() => replayer.stop());
```

---

### DB Idempotency
- Unique key: `{ service, requestId }`, or  
- `_id = sha256(service + ":" + requestId)`  
Ensures safe re-emission during replay.

---

### Rotation & Pruning
Files are monotonic; once cursor passes EOF, pruning is optional and governed by retention window config.

---

### Metrics / Logs
- `replay_started {walDir, cursorPath}`
- `replay_batch_ok {file, count, bytes}`
- `cursor_advanced {file, newOffset}`
- `replay_idle`
- `replay_error {err}`

---

## Alternatives
1. **Fold replay into `Wal`** — rejected (SRP violation, complex backpressure).  
2. **DB as the only queue** — rejected (FS persistence needed).  
3. **Multi-process replay with locks** — deferred.

---

## References
- **SOP:** NowVibin Backend — Core SOP (Reduced, Clean)  
- **Session Notes — 2025-10-08 (Late):** WAL Resilience Plan  
- **Services:** Gateway (emits to Audit) / Audit (persists to DB)
