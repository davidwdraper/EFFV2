# adr0056-delete-type-in-path

**Title:** DELETE uses path-segment DTO type for deterministic collection resolution  
**Status:** Accepted  
**Supersedes:** adr0055-delete-requires-dto-type (query-param approach)  
**Date:** 2025-11-04  
**Scope:** All NV CRUD and multi-DTO services

---

## Context

- Services may host multiple DTO types; neither `slug` nor `id` identifies the collection.  
- We refuse read-first type discovery and any id encoding hacks.  
- We need an explicit, low-ambiguity way for clients to specify the DTO to delete.

## Decision

Adopt **path-segment type** for delete routes:

```
DELETE /api/<slug>/v1/<DtoTypeKey>/:id
```

Where `<DtoTypeKey>` is the exact key registered in the `DtoRegistry` (e.g., `EnvServiceDto`, `XxxDto`).

## Controller Contract

- Extract `typeKey` from `req.params.typeKey` (router names it `:typeKey`).  
- Resolve ctor via `DtoRegistry.resolve(typeKey)`; on failure → **400** (`UNKNOWN_DTO_TYPE`).  
- Seed `ctx.set('delete.dtoCtor', ResolvedCtor)` and run the pipeline with `requireRegistry:true`.
- Canonical id param remains `:id`.

## Handler Contract

- Require `delete.dtoCtor` and `svcEnv`.  
- Use `DbDeleter.fromDtoCtor(svcEnv, dtoCtor).deleteById(id)`.  
- If `deletedCount === 0` → **404** (template policy). Idempotence strategy can be revisited in a future ADR if needs change.

## Router (Template Service)

- `DELETE /:typeKey/:id` (relative to `/api/<slug>/v1`).  
- Remove legacy `/delete` variants and param name fallbacks.

## Client Responsibilities

- The client must carry the DTO type from prior reads/lists (ADR-0050 envelope includes type).  
- For delete, call the path form with that type: `/v1/<DtoTypeKey>/<id>`.

## Consequences

- ✅ Deterministic collection without extra I/O.  
- ✅ Strong coupling to Registry (missing registrations surface quickly).  
- ✅ Clear, inspectable URLs for ops and logs.  
- ❌ Slightly longer URLs; acceptable tradeoff for correctness and speed.

## References

- ADR-0040, ADR-0041, ADR-0042, ADR-0048, ADR-0050  
- **Superseded:** ADR-0055 (query-param `?type=`)  
