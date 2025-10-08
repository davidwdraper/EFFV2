# adr0022-shared-wal-and-db-base

# Shared Write-Ahead Log (WAL), DB Base Class, and Audit Service Refactor

**Status:** Proposed → Accepted (on merge)  
**Date:** 2025-10-08  
**Owner:** NV Backend (Gateway, Audit)  
**Related:** ADR-0013 (Versioned Health), ADR-0015/0016 (Logger & Runtime Config), Core SOP (Reduced, Clean)

---

## Context

The last backend had gateway API auditing working but the code devolved into spaghetti. The new backend is green and clean, but auditing is missing. We need an **environment-agnostic** audit spine that:

- Uses a **shared WAL** in both the Gateway (producer) and Audit service (consumer/ingest) for durability and backpressure.
- Provides a **shared DB base class** to standardize connection, liveness/readiness, and retry semantics (service-specific subclasses implement their chosen driver).
- Refactors the **Audit service** onto our **AppBase / RouterBase / ControllerBase** rails, with strict contracts and versioned health endpoints.
- Establishes a **direct-hit smoke** to validate the Audit service before wiring Gateway audit middleware.

Constraints (from SOP & addendum):

- No literals, no env-specific defaults. **Dev == Prod** in behavior.  
- **No backwards-compat shims**; we prefer a clean break.  
- Canonical truth lives in **shared Zod contracts**.

---

## Decision

### 1) Canonical Audit Contracts (Shared)

Create `backend/services/shared/src/contracts/audit.contract.ts`:

- `AuditEntry` (minimal viable envelope):

  ```typescript
  {
    requestId: string;              // x-request-id
    service: string;                // emitter slug (e.g., "gateway")
    target: { slug: string; version: number; route: string; method: string };
    phase: "begin" | "end";         // audit start/end of a call
    ts: number;                     // ms epoch (emitter clock)
    status?: "ok" | "error";        // set at "end"
    http?: { code?: number };       // set at "end"
    err?: { name?: string; message?: string; stack?: string }; // on failure
    meta?: Record<string, unknown>; // additive only
  }
  ```

- `AuditBatch = { entries: AuditEntry[] }`

These are Zod-validated and used by both Gateway and Audit service.

---

### 2) Shared WAL

Create `backend/services/shared/src/wal/Wal.ts`:

- **Interface**

  - `append(entry: AuditEntry): void`
  - `appendMany(entries: AuditEntry[]): void`
  - `flush(): Promise<{ persisted: number; lastOffset: number }>`
  - `rotate(reason?: string): Promise<void>`

- **Behavior**

  - Tier-0 durability: **in-memory queue** with `maxInMemory` backpressure (auto-flush).  
  - Optional Tier-1: **filesystem journal** (`WAL_FS_ENABLED=true`)  
    - Line-delimited JSON appends with atomic `fs.appendFile`.
    - Rotation by size/time: `WAL_ROTATE_BYTES`, `WAL_ROTATE_MS`.
  - **No silent fallbacks**: if FS tier is enabled and fails, we error and surface it.
  - Env-pure configuration; no literals.

- **Intended use**

  - **Gateway**: audit(begin) + audit(end) go to WAL; a local flusher batches to AuditSvc (`POST /api/audit/v1/entries`).
  - **AuditSvc**: HTTP ingest appends to WAL; a background worker flushes WAL → DB.

---

### 3) Shared DB Base

Create `backend/services/shared/src/db/DbBase.ts`:

- Abstract class:

  - `connect(): Promise<void>`
  - `disconnect(): Promise<void>`
  - `isLive(): boolean`                      // quick, in-process signal
  - `isReady(): Promise<boolean>`            // readiness gate (e.g., ping DB)
  - `withRetry<T>(op: () => Promise<T>): Promise<T>` // bounded retry with jitter

- Env-only: URIs, creds, pool sizes, timeouts come from env/config.  
- Each service provides a concrete subclass (e.g., `AuditDb extends DbBase`) to wire a specific driver (document store preferred initially).

---

### 4) Audit Service Refactor (slug: `audit`)

- **Versioned health**: `/api/audit/v1/health/{live,ready}`.
- **Ingest route**: `POST /api/audit/v1/entries`
  - Validates `AuditBatch`.
  - **Appends to WAL** and returns `{ ok:true, service:"audit", data:{ accepted:n } }`.
  - No DB writes on the hot path (keeps latency flat).
- **Background flusher** (interval, configurable):
  - `wal.flush()` → `AuditRepo.persist(batch)` using `AuditDb` (extends `DbBase`).
  - On persist failure: WAL remains unacknowledged; flusher retries via `withRetry`.
- **Structure**:
  - `AppBase` + `RouterBase` + `ControllerBase`
  - Controllers return canonical envelopes, are fully instrumented (entry/exit) with `x-request-id`.
  - No references to `127.0.0.1`, `localhost`, or ports—env/config only.

---

### 5) Phased Rollout

- **Phase A (this ADR)**: Build shared contracts, WAL, DB base. Refactor AuditSvc.  
  Add smoke: **direct POST** to `audit` (no gateway).
- **Phase B (follow-up ADR if needed)**: Add Gateway audit middleware (begin/end), local WAL + flusher → AuditSvc.

---

## Consequences

- Single WAL/DB substrate reduces drift and hardens durability guarantees.
- Latency in hot HTTP paths is minimal; persistence is decoupled via WAL.
- Crash resilience improves (optional FS journal).
- Slightly higher complexity (flusher loop), but contained and testable.

---

## Implementation Notes

### New Files (Shared)

- `services/shared/src/contracts/audit.contract.ts`
- `services/shared/src/wal/Wal.ts`
- `services/shared/src/db/DbBase.ts`

### Audit Service Touch Points

- `services/audit/src/app.ts`
- `services/audit/src/routes/health.router.ts`
- `services/audit/src/routes/ingest.router.ts`
- `services/audit/src/controllers/audit.ingest.controller.ts`
- `services/audit/src/repo/audit.db.ts` (extends `DbBase`)
- `services/audit/src/repo/audit.repo.ts`
- `services/audit/src/workers/audit.flusher.ts`

### Environment (names only; values live in `.env.*`)

- **AuditSvc**
  - `NV_AUDIT_PORT`
  - `AUDIT_DB_URI`, `AUDIT_DB_NAME`, `AUDIT_DB_COLLECTION`
  - `WAL_FLUSH_MS` (e.g., 1000), `WAL_MAX_INMEM` (e.g., 1000)
  - `WAL_FS_ENABLED` (true|false), `WAL_DIR`, `WAL_ROTATE_BYTES`, `WAL_ROTATE_MS`

- **Gateway (Phase B)**
  - `AUDIT_BASE_URL` (service discovery will ultimately come from svcconfig)
  - Reuse `WAL_*` variables for its local WAL + flusher

### Middleware Order (Phase B Preview)

`DoS/guards → edge logger → (auth later) → audit(begin) → proxy → audit(end) → error sink`

### Data Model (initial)

- Schemaless document store (JSON).  
- Indexing can be deferred; start with timestamp and requestId indexes when DB chosen.

---

## Acceptance Criteria

1. **Contracts** compile and validate typical begin/end entries.
2. **Shared WAL** supports in-memory + optional FS tier; flush/rotate works.
3. **Shared DB Base** exposes the required lifecycle and retry API.
4. **AuditSvc** `POST /api/audit/v1/entries`:
   - Valid batch → `{ ok:true, service:"audit", data:{ accepted:n } }`
   - Invalid batch → canonical problem response via global error middleware
5. **Health**:
   - `/live` returns `ok:true` once app is running
   - `/ready` returns `ok:true` only after DB connect succeeds
6. **Smoke (009-audit-direct-append.sh)** passes end-to-end without gateway.

---

## Test Plan (Phase A)

- **Unit** (shared):
  - WAL: append/flush/backpressure/rotation; FS tier on/off.
  - Contracts: zod parse for valid/invalid payloads.
  - DbBase: retry path with injected failing op.
- **Integration** (AuditSvc):
  - Boot with DB reachable → `/ready` true.
  - POST 2 entries (begin/end) → `accepted:2`; flusher persists; verify via repo count/readback (test hook).
- **Smoke**:
  - `curl -s -X POST $AUDIT_URL/entries -d '{ "entries":[...] }'` → ok + accepted
  - `/health/live` & `/health/ready` behave correctly.

---

## Alternatives Considered

- Push to DB on HTTP path (simpler, higher latency, tight coupling) — **Rejected**.  
- Centralized WAL daemon for all services — **Overkill now**; revisit if ops demands it.  
- Kafka (or similar) now — **Too early**; we can swap the WAL backend later with a new `Wal` driver.

---

## Risks & Mitigations

- **Clock skew** (ts from emitter): tolerate; server DB adds ingest timestamp; optional future NTP checks.  
- **WAL growth** under DB outage: backpressure caps in-memory; FS tier + rotation; ops alerting later.  
- **FS tier corruption**: line-delimited JSON with append-only + rotate; on load, skip malformed lines.

---

## Rollout

- Merge shared contracts/WAL/DbBase → refactor AuditSvc → land **Smoke 009**.  
- Only after green: introduce Gateway audit middleware with its own WAL + flusher (Phase B).

---

## Open Questions

- Which DB driver for Audit first pass? (Document store is assumed; we’ll implement `AuditDb` once you confirm choice.)  
- Desired WAL flush cadence vs. durability (defaults proposed; tune with real load).

---

## References

- Core SOP (Reduced, Clean)  
- ADR-0013, ADR-0015, ADR-0016  
- Session Notes — 2025-10-08 (RouterBase sweep; all green)  
- Environment Invariance Addendum
