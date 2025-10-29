adr0047-dtobag-batching-and-pagination
# ADR-0047 — DtoBag, DtoBagView, and DB-Level Batching (Paging-as-a-Client)

**Status:** Accepted  
**Date:** 2025-10-29

## Context
We standardize how in-memory collections of DTOs are represented and how large reads are chunked. We want:
- A generic, immutable container for DTOs (no domain-specific bags).
- A read-only "lens" for filtering/sorting without copying DTOs.
- Clear placement of **batching** (DB-first), with paging as a consumer of batching, not its definition.
- Symmetry between read and write paths using DTOs as the only data authority (single `toJson()`/ctor-from-JSON path).
- Deterministic, scalable behavior for long lists (e.g., events around a user’s location).

Layers in scope: **DB → DbReader/DbWriter → Dto → DtoBag → DtoBagView**.

## Decision
1) **DtoBag (immutable, generic)**
   - The single in-memory container for DTOs, regardless of purpose.
   - Holds an ordered master array of DTOs; **never mutates**.
   - Public creates only **DtoBagView**s (no raw array exposure).

2) **DtoBagView (read-only lens)**
   - Holds only **indices** into a DtoBag (no DTO copies, no data storage).
   - Clients iterate **views** only. Any refinement (filter/sort/slice) is requested **from DtoBag**, which returns a new view built *over a base view*.
   - Multiple views can coexist over a single bag.
   - Stable sort is mandatory before slicing for paging-like use cases.

3) **DbReader owns batching**
   - `readOne()` → returns a **single DTO**.
   - `readBatch()` → returns a **DtoBag** (one batch). Accepts filters, sort spec, and an optional **opaque cursor** to get the *next* batch.
   - Uses **DB keyset (cursor) pagination**, not skip/limit, with a stable compound sort (e.g., `startAt asc, _id asc`).

4) **DbWriter mirrors the read symmetry**
   - `writeOne(dto)` and `writeBatch(dtoBag)`; never accepts raw JSON.
   - Serializes via `dto.toJson()`; no DTO mutation; returns structured results for Ops.

5) **Paging is a consumer of batching**
   - Backend pagination is implemented by **DbReader** batches + cursors.
   - Frontend/local paging (when datasets are small or already loaded) is implemented as **DtoBagView slices** on a **stable** view.
   - Controllers decide which mode to use; neither mode mutates Bag or DTOs.

6) **Filtering rules**
   - **Primary filtering is DB-side** (spatial/H3, hard filters).
   - **Twitchy UI filters** (genre, busy-level toggles) are **in-memory** on **DtoBagView** via O(n) passes; no in-memory indexes in v1.
   - If a view requires repeated heavy lookup, we may add optional per-request in-memory indexes later (not in this ADR).

## Consequences
- Clear separation of concerns: DB does scale; Bag/View do presentation and simple transforms.
- Deterministic paging: no duplicates or misses under churn (keyset with tie-breaker).
- Minimal memory: views store only indices; no duplicated DTOs.
- Controllers are thin: **DbReader** provides batches; Bag/View provide ergonomics.
- Easy testability: DtoBagView behavior is pure and side-effect free.

## Implementation Notes
- **Stable order spec** must include a unique tie-breaker (e.g., `_id`) and be attached to the view when built.
- **Cursor schema (opaque)** should at least encode: `order`, `last` item’s sort keys, and a `rev` hash of area+filters+order to detect staleness.
- **DB indexing (Mongo example)**:
  - Primary: `{ h3: 1, startAt: 1, _id: 1 }` for event lists by location+time.
  - Consider selective indexes for high-frequency filters (e.g., `genre`, `venueType`).
- **Dto creation**: constructor accepts JSON + `{ validate?: boolean }`; static helpers like `fromJsonArray()` reduce boilerplate for batch hydration.
- **View API (conceptual)**: `viewAll()`, `viewFilter(predicate, base)`, `viewInclude/Exclude(prop, values, base)`, `viewWhere(plan, base)`, `viewOrderBy(prop, dir, base)`, `viewPaginate(offset, limit, base)`, plus iteration & `toJsonArray()`.
- **No mutation paths** in Bag/View. If data must change, perform a fresh DB read (new bag).

## Alternatives Considered
- **All paging in memory**: simple but does not scale; duplicates/misses under churn; unacceptable for large result sets.
- **Per-entity bags (e.g., VenueDtoBag)**: more classes, more drift, little benefit; rejected in favor of a single generic bag.
- **Offset paging (`skip/limit`)**: easy but slow and non-deterministic on changing data; rejected in favor of keyset.
- **Global in-memory indexes**: add complexity and staleness concerns; postpone unless profiling proves a hotspot.

## References
- SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
- ADR-0045 (NV Service Clone Tool — zip → rename → zip)
- Session notes 2025‑10‑28 → 2025‑10‑29 (DtoBag, DtoBagView, DbReader/DbWriter roles; batching vs. paging)
