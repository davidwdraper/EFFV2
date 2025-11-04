// docs/architecture/backend/ADRs/adr0048-dbreader-dbwriter-contracts.md

# ADR-0048 — DbReader & DbWriter Contracts (DTO-First, **Bag-Centric**)

**Status:** Accepted (Revised)  
**Replaces:** ADR-0048 (2025-10-29)  
**Date:** 2025-11-04

## Context

We standardized on `DtoBag` as the container for moving DTOs across layers (DB, FS, WAL, network edge). Earlier text said `DbReader.readOne()` returns a single DTO and `readBatch()` returns a `DtoBag`. That asymmetry forces call-sites to juggle `null`/empty DTOs vs. empty bags and invites drift.

## Decision

**All reads and writes speak “bag.”** A single result is a **singleton bag** (size = 1). No naked DTOs cross the persistence boundary.

- `DbReader` always returns a `DtoBag` (possibly empty) with meta/cursor where applicable.
- `DbWriter` accepts a `DtoBag` (singleton or many).  
  Sugar helpers may exist, but the canonical interface is bag-centric.

## Interfaces (canonical)

### DbReader

```ts
type ReadMeta = {
  requestId: string;
  limit: number;
  total?: number | null;
  cursor: string | null;
};

interface DbReader<TDto /* extends IDto */> {
  // Primary: read one by primary key, returned as a BAG (0..1)
  readOneBag(opts: {
    id: string;
    requestId?: string;
  }): Promise<{ bag: DtoBag<TDto>; meta: ReadMeta }>;

  // Batch read with filters and deterministic order; returns a BAG (0..N) + next cursor when applicable
  readBatch(opts: {
    filters: Record<string, unknown>;
    order: Array<{ field: string; dir: "asc" | "desc" }>; // must include unique tiebreaker (e.g., _id asc)
    limit: number;
    cursor?: string | null;
    requestId?: string;
  }): Promise<{
    bag: DtoBag<TDto>;
    meta: ReadMeta;
    nextCursor?: string | null;
  }>;

  // Optional: diagnostics
  explain?(
    filters: Record<string, unknown>,
    order: Array<{ field: string; dir: "asc" | "desc" }>
  ): Promise<unknown>;
}
```
