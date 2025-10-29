adr0048-dbreader-dbwriter-contracts
# ADR-0048 — DbReader & DbWriter Contracts (DTO-First, Batch-Centric)

**Status:** Accepted  
**Date:** 2025-10-29

## Context
We need clear, DTO-first boundaries for reading and writing data that scale from single-record ops to large, streaming workloads. The stack is: **DB → DbReader/DbWriter → Dto → DtoBag → DtoBagView**. Batching is a first-class concern and is owned by the data-access layer. Controllers stay thin and consume batches without leaking DB mechanics.

## Decision
1) **DbReader** is the authoritative batching interface for reads.
   - `readOne()` returns a **single hydrated DTO**.
   - `readBatch()` returns a **DtoBag** and, when applicable, an **opaque cursor** for the next batch (keyset).
   - Performs primary filtering at the DB (e.g., spatial/H3, equality/range constraints) and enforces a **stable compound order** for determinism (e.g., `startAt asc, _id asc`).

2) **DbWriter** mirrors the read symmetry for writes.
   - `writeOne(dto)` persists a single DTO (create/update/upsert per call-site semantics).
   - `writeBatch(dtoBag)` persists multiple DTOs in one logical operation (bulkWrite/transaction when supported).
   - Accepts **only DTOs/DtoBags**; serializes via `dto.toJson()`. No raw JSON crosses the boundary.

3) **DTO is the single authority**.
   - DTO constructors accept raw JSON (`{ validate?: boolean }`) and normalize/validate internally.
   - Persistence always flows through `toJson()`; DTO instances remain immutable from the persistence layer’s perspective.

4) **Paging is a consumer of batching**.
   - Backend pagination = repeated `readBatch()` calls using cursors.
   - Frontend/local paging over small sets = slicing a `DtoBagView` (no DB involvement).

## Interfaces (conceptual, not code)
**DbReader**
- `readOne(queryOrKey) → Dto | null`
- `readBatch(filters, order, limit, cursor?) → { bag: DtoBag<Dto>, nextCursor?: string }`
- `explain?(filters, order) → PlanInfo` (optional; ops diagnostics)

**DbWriter**
- `writeOne(dto, options?) → WriteResult`
- `writeBatch(bag, options?) → BatchWriteResult`
- `deleteOne(key, options?) → DeleteResult`
- `deleteBatch(keysOrFilter, options?) → BatchDeleteResult`

**Order & Cursor**
- `order` = ordered list of fields + directions; MUST include a **unique tie-breaker** (e.g., `_id`).
- `cursor` (opaque, base64 JSON) encodes: `{ order, last: <key values>, rev: <hash(filters+order+scope)> }`.
- `rev` detects staleness (area/filters/order changes). Stale cursors return **409 cursor_stale**.

## Implementation Notes
- **Keyset (cursor) pagination** only; avoid `skip/limit` for large/active sets.
- **Indexes (Mongo example)** should reflect hottest access paths, e.g.:
  - Events by area/time: `{ h3: 1, startAt: 1, _id: 1 }` (forward) and/or `{ startAt: 1, h3: 1, _id: 1 }`.
  - Consider selective indexes for frequent filters (e.g., `genre`, `venueType`).
- **Hydration**: only hydrate the current batch. Never hydrate the full result set.
- **Idempotency**: `writeBatch` must be safe to retry where feasible (use natural keys or idempotency keys when appropriate).
- **Transactions**: use per storage engine capability; otherwise emulate with WAL + compensating actions.
- **Validation**: `readOne/readBatch` may request `{ validate:true }` from DTO constructors for stricter paths (e.g., external ingestion); default paths can skip for speed if prior layers guaranteed shape.

## Error Model (Ops-friendly)
- All results return structured outcomes and hints:
  - `ok`, `n`, `nModified`, `duplicates`, `conflicts`, `violations`, `notFound`, `retryAfter`, `suggestion`.
- Common failure classes:
  - **cursor_stale** (409): filters/order changed → client must restart.
  - **precondition_failed** (412): optimistic concurrency (e.g., revision mismatch).
  - **duplicate_key** (409): unique index violation; include index name + offending key.
  - **validation_error** (422): DTO validation failed; include field hints (sanitized).
  - **throttled** (429): rate/throughput guard; include backoff guidance.

## Security
- DbReader/DbWriter never log secret values; log **hashes** or redacted placeholders.
- For secret-bearing DTOs, DbReader supports redacted reads by default; privileged paths must opt-in explicitly.
- All S2S access is via gateway-issued short-lived tokens; DbReader/DbWriter do not manage auth—only enforce per-call options (e.g., `includeSecrets` flags) as allowed by policy.

## Observability
- Log structured breadcrumbs for every batch:
  - `{ requestId, component, op: 'readBatch'|'writeBatch', order, limit, filterHash, pageEdge: { first, last }, n }`
- Emit metrics: counters (`read_batches_total`, `write_batches_total`), histograms (`batch_latency_ms`, `batch_size`), and error counters by class.
- Add tracing spans around DB calls with tags for index and plan (when available).

## Consequences
- Clean, predictable boundaries: controllers orchestrate; DbReader/DbWriter scale.
- DTOs remain the single source of truth; no schema/model leaks.
- Deterministic batching with minimal duplication and strong ops signals.
- Reusable for non-UI workflows (exports, WAL replay, fan-out jobs) that need chunked processing.

## Alternatives Considered
- Putting batching into controllers or services: leads to duplication and drift; rejected.
- Accepting raw JSON in writers: bypasses DTO guarantees; rejected.
- Offset pagination: simple but non-deterministic and slow at scale; rejected.

## References
- ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
- SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
