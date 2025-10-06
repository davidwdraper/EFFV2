// docs/adr/adr0017-write-ahead-log-wal-shared-for-logs-audit-and-future.md

# ADR-0017 — Shared Write-Ahead Log (WAL) for Logger, Audit, and Future Features

**Status:** Proposed — 2025-10-06  
**Owners:** Backend Core

## Context

We cannot lose critical telemetry under any circumstance:

- **Operational logs** destined for DB persistence (per ADR-0016 runtime config).
- **Audit events** (security/compliance trail).
- **Future features** that need durable, out-of-band shipping (e.g., metrics, billing traces, anomaly reports).

Transient network failures or log-service downtime must not drop records. We need one **shared**, durable **WAL** mechanism used consistently across services—no bespoke queues per feature.

## Decision

Create a **shared WAL library** in `@nv/shared/wal` that is the **single** write-ahead mechanism for:

1. **Logger** persistence (when ADR-0016 config enables it).
2. **Audit** event persistence (mandatory; no “best effort”).
3. **Any future feature** that requires durable, eventually-delivered shipping.

### Properties

- **Durable append** to local rolling files (newline-delimited JSON).
- **Bounded** by size and age (e.g., 256MB per service; 24h retention).
- **At-least-once delivery** via shipper (batch POST) with idempotent ingest.
- **Backpressure-aware**: exponential backoff; circuit-breaker; metrics surfaced.
- **Checkpointed** progress per file (offsets) to resume after restarts.
- **Per-service isolation** (`$VAR_DIR/nv-wal/<service>/...`).

### Integrations

- **Logger → WAL → Log Service**  
  Logger decides persistence (ADR-0016 runtime config); persistent entries are appended to WAL and shipped to `/api/log/v1/ingest`.
- **Audit → WAL → Audit Sink**  
  Audit always appends to WAL and ships to `/api/audit/v1/ingest` (or message bus, future). **Audit never drops.**
- **Others (future)**  
  Any component with durability needs uses the same WAL interface.

## Consequences

- ✅ One well-tested, shared primitive for durability; simpler ops & fewer bugs.
- ✅ Uniform metrics and behavior (backoff, retries, GC).
- ⚠ Requires **refactoring** existing gateway/audit code paths to the new shared WAL.

## Implementation Notes

- **Module:** `backend/services/shared/src/wal/`

  - `LogWal.ts` (core engine)
  - `WalShipper.ts` (batcher/backoff/checkpoint)
  - `WalFsStore.ts` (file rotation + retention)
  - `types.ts` (record + envelope shapes)

- **Record Shapes:**

  - `LogRecord { ts, service, level, category?, msg?, ctx?, data? }`
  - `AuditRecord { ts, service, actor, action, resource, outcome, ctx?, data? }`
  - Store on disk as NDJSON; each line is `{ kind: "log" | "audit" | "<future>" , record: ... }`.

- **Batching & Shipping:**

  - Configurable envs: `WAL_BATCH_MAX=2000`, `WAL_MAX_BYTES=268435456` (256MB), `WAL_MAX_AGE_H=24`.
  - POST endpoints:
    - Logs → `POST /api/log/v1/ingest` (S2S JWT; optional gzip).
    - Audit → `POST /api/audit/v1/ingest` (S2S JWT; optional gzip).
  - Idempotency: include `id` or `(ts, service, seq)`; sinks must be idempotent.

- **Metrics (stdout + health detail):**  
  `wal_backlog_records`, `wal_backlog_bytes`, `wal_ship_errors_total`, `wal_dropped_records_total`, `wal_last_ship_ts`, `wal_current_file`, `wal_current_offset`.

- **Failure Modes:**
  - If sink down: backlog grows; alerts fire when thresholds exceeded.
  - If disk full or bounds exceeded: drop oldest files; increment `wal_dropped_records_total` (visible in health).

## Required Refactors (Stop-the-line after merge window)

- **Gateway:** replace any ad-hoc file/queue logging with `@nv/shared/wal`.
- **Audit Service/Lib:** route all audit writes through the shared WAL (no direct HTTP-only paths).
- **Shared Logger:** when ADR-0016 says “persist”, append via WAL rather than direct HTTP.

## Alternatives

- Separate WALs per feature → duplicated logic, drift, and inconsistent ops.
- Rely on in-memory buffers → data loss on crash/outage.

## Security & Compliance

- S2S JWT for all ingest endpoints; audit config changes.
- Optionally HMAC each batch; include monotonic clock skew tolerance (future ADR if needed).
- PII fields must be explicit; redact at source where required.

## References

- ADR-0016 (Logging Architecture & Runtime Config)
- ADR-0014 (Base Hierarchy)
- ADR-0015 (Logger with `.bind()`)
