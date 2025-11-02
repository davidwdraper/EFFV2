adr0050-batching-and-cursor-semantics
# ADR-0050 — Batching & Cursor Semantics under DtoBag/Registry

Date: 2025-11-02

## Context
We have pre-existing batch readers, cursor pagination, and smoke tests that assume `DtoBag` wrapping. The migration to unified `id` and registry-based DTO instantiation must not regress large scans or pagination behavior.

## Decision
1) **`DtoBag.meta` is authoritative** for pagination and telemetry:
   - `cursor: string | null`
   - `limit: number`
   - `total: number | null` (optional for count-free scans)
   - `page?: number` (legacy compatibility)
   - `elapsedMs: number`
   - `requestId: string`
2) **Cursor contract**: opaque, stable for the lifetime of the scan window; may encode collection, index, and last key. Never parse client-side.
3) **Batch limits**: enforce a hard server cap; return guidance when exceeded.
4) **Type-aware scans**: for mixed-type queries, clients **must** include `type` in filters for sortability; otherwise only `id`/cursor-order is guaranteed.
5) **Id-only filters**: reader accepts only **strings** for ids; adapter maps to DB-native types.
6) **Deterministic ordering**: when no explicit sort is provided, default to `{createdAt, id}` (both normalized to app types before DTO creation).

## Consequences
- Existing batch smoke tests remain relevant; they must be updated for `id`/`type` and meta naming.
- Predictable cross-service batching; adapters remain the sole guardians of DB specifics.

## Implementation Notes
- Add `BatchPlan` helper to compute effective `limit`, enforce caps, and stamp `elapsedMs`/`requestId` into `DtoBag.meta`.
- Ensure `DbReader` emits `DtoBag` even for single-record reads for consistency with controllers.
- Add `nextCursor` test coverage for empty final pages and for “exact multiple of limit” edge case.

## Alternatives
- Offset-based pagination → unstable under concurrent writes; rejected.

## References
- ADR-0049 — unified edge payload and registry
- SOP — audit and instrumentation requirements

