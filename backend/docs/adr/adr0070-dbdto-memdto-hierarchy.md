adr0070-dbdto-memdto-hierarchy

# ADR-0070 — DbDto vs MemDto: Explicit DTO Hierarchy for Persistence vs In-Memory “Quark” DTOs

## Context

The NowVibin backend currently uses a single DTO base type (DtoBase) for all
data transfer objects. These DTOs serve multiple roles:

- Long-lived, DB-backed records (e.g., env-service, svcconfig, CRUD entities).
- Wire-level DTOs carried in DtoBag envelopes between services.
- Short-lived, in-memory “quark” DTOs that never touch persistence, used only
  to move structured data through handler pipelines and controllers.

To support generic persistence rails (DbWriter/DbReader/DbDeleter), DTOs
currently carry persistence metadata such as `dbCollectionName`. This has
been very effective for keeping CRUD logic generic, but it also blurs the
line between:

- DTOs that **are** DB records and must know their collection; and
- DTOs that are purely **in-memory data carriers** and should never be
  persisted or coupled to a collection.

This creates several issues:

1. **Conceptual drift**  
   DTOs are treated as “pure contracts” in docs and mental models, but in
   practice many of them are “tiny ORM records” with persistence concerns
   baked in. This disconnect makes reasoning and future refactors harder.

2. **Safety gaps**  
   There is no type-level distinction between “this DTO may be persisted”
   and “this DTO must never be persisted.” A quark DTO can accidentally be
   passed into DbWriter at compile time unless we rely solely on discipline.

3. **Over-generalization risk**  
   If we try to keep one DTO type for everything and simply “avoid using DB
   metadata on quark DTOs,” we end up with implicit, undocumented rules that
   are easy to violate under pressure.

At the same time, the generic persistence rails are a core design goal:

- DtoBag + DbWriter/DbReader should remain the primary way DB-backed
  services persist and load records.
- We do not want to move to a per-service, per-operation client model
  (e.g., `AuthClient.createUser()` everywhere) as the main architecture.
- 95%+ of DTOs will be DB-backed in practice, and the current design has
  worked well for those.

We need a way to make the **existing reality explicit** while preserving the
generic rails and avoiding the need for “micro SDKs” for every service.

## Decision

We will introduce an explicit DTO hierarchy that distinguishes between
DB-backed DTOs and in-memory-only DTOs, while keeping the existing rails
(DtoBag, DbWriter/DbReader/DbDeleter) intact.

### 1. DtoBase remains the abstract root

`DtoBase` remains the abstract base class that defines the common DTO
contract:

- Core identity / key semantics (e.g., `<slug>Id`).
- `toJson()` / `fromJson()` behavior (wire shape based on Zod contracts).
- Validation and invariant enforcement.
- DTO-level helpers that are independent of storage.

`DtoBase` must not know anything about:

- Mongo collections.
- DB index hints.
- Transport paths or svcconfig.

It is strictly the shared foundation for DTO behavior.

### 2. DbDto — DB-backed DTOs (persistent records)

We introduce `DbDto` as a concrete abstract subclass of `DtoBase` for
DB-backed DTOs:

- `abstract class DbDto extends DtoBase { ... }`

`DbDto` is the **only** DTO base that may carry persistence metadata, such as:

- `getDbCollectionName(): string` (or equivalent property/method).
- Optional DB-specific hints where absolutely necessary (still preferring the
  registry for index hints and collection naming, per LDD-05).

Invariants:

- Any DTO that is persisted to Mongo **must** extend `DbDto`.
- Any `DtoBag` that is passed to `DbWriter` / `DbReader` / `DbDeleter`
  **must** be `DtoBag<DbDto>` (or a more specific subclass).
- Quark / in-memory DTOs **must not** extend `DbDto`.

Naming convention (for DB-backed DTOs):

- DTOs that represent “real” records (env-service config, CRUD entities,
  svcconfig entries, auth users, etc.) keep the existing `<Name>Dto` naming
  pattern and extend `DbDto`.

This makes the existing “DTO as tidy DB record” pattern explicit and honest.

### 3. MemDto — in-memory-only “quark” DTOs

We introduce `MemDto` as a concrete abstract subclass of `DtoBase` for DTOs
that are **never** persisted directly to DB:

- `abstract class MemDto extends DtoBase { ... }`

`MemDto` characteristics:

- Carries **no** persistence metadata (no collection name, no index hints).
- Used for short-lived, in-memory-only purposes:
  - Pipeline-local data carriers.
  - Aggregated or derived data structures.
  - Wire-only or controller-only DTOs that are not stored directly.

Invariants:

- `MemDto` instances must never be passed to DbWriter/DbReader/DbDeleter.
- Any attempt to do so is a design error; the type system should prevent it
  and runtime guards should fail fast if misused.

Naming convention (for in-memory DTOs):

- DTOs whose purpose is clearly “operational / transient” may still end with
  `Dto` for consistency (e.g., `<Purpose>Dto`), but their base class must be
  `MemDto` instead of `DbDto`.
- The distinction between DbDto vs MemDto is made by base class, not by
  suffix. Suffixes remain short and descriptive; the base class encodes
  the “birthplace and destination” semantics.

### 4. DtoBag remains generic but constrained by usage

`DtoBag<T extends DtoBase>` remains the core container for DTOs. The key
change is in **who** is allowed to use which specialization:

- `DtoBag<DbDto>`:

  - Legal input to DbWriter/DbReader/DbDeleter.
  - Represents a collection of persistent records.

- `DtoBag<MemDto>`:
  - Legal for pipelines, controllers, and in-memory processing.
  - Must **never** be given to persistence layers.

Generic callers may still use `<T extends DtoBase>`, but persistence rails
must be explicitly typed to `DbDto` (or constrained via `T extends DbDto`).

### 5. No new stores or “micro SDKs”

This ADR explicitly **does not** introduce:

- New storage layers beyond Mongo.
- A proliferation of per-service “client SDKs” as the primary pattern
  (e.g., `AuthClient.createUser()` everywhere).

Existing generic rails remain:

- Services still use generic CRUD flows: DTO → DtoBag → DbWriter/DbReader.
- The focus is on making the DTO hierarchy more honest and type-safe, not on
  replacing generic rails with bespoke per-service clients.

### 6. Enforcement & guidelines

- Any DTO that is persisted must be a `DbDto` and must be registered in the
  DTO registry with explicit metadata (collection name, dtoType, etc.).
- Any DTO that is purely in-memory should extend `MemDto` and must not
  expose DB-related helpers.
- Shared rails (e.g., handlers, controllers, persistence helpers) must use
  type constraints to ensure they only accept the intended DTO base type.

## Consequences

### Benefits

1. **Honest modeling of reality**  
   We stop pretending all DTOs are pure, storage-agnostic entities. The
   majority of DTOs are DB-backed records; DbDto makes that explicit and
   documents their “destination in life.”

2. **Type safety around persistence**  
   The type system now clearly distinguishes between “may be persisted” and
   “must never be persisted.” Misuse (e.g., passing a MemDto to DbWriter)
   becomes a compile-time error (and can be backed by runtime guards).

3. **Clearer mental model**

   - DbDto: long-lived records, persisted via generic rails.
   - MemDto: short-lived quark DTOs, used inside pipelines/controllers.
   - DtoBase: shared behaviors and contracts.

4. **Preserves generic rails**  
   We keep the powerful, generic DbWriter/DbReader pattern and do not move to
   a more complex per-service client model for the majority of CRUD flows.

5. **Simpler future evolutions**  
   If we later add non-Mongo storage or special-case persistence behavior,
   DbDto vs MemDto gives us a clean place to hang those concerns without
   infecting all DTOs.

### Costs

1. **Refactor effort**  
   Existing DTOs must be updated to extend either DbDto or MemDto. This may
   require touching a significant number of files, though the mechanical
   nature of the change makes it manageable.

2. **Type churn**  
   DbWriter/DbReader/DbDeleter signatures and some shared handlers will need
   to be updated to reflect `DbDto` constraints instead of generic DtoBase.
   This will briefly increase friction while compilation issues are resolved.

3. **Naming discipline**  
   While base classes encode semantics, humans still need to be consistent in
   choosing whether a new DTO is truly DB-backed (DbDto) or purely in-memory
   (MemDto). This is more of a process discipline cost than a technical one.

## Implementation Notes

1. **Introduce DbDto and MemDto in shared DTO base module**

   - Add `DbDto` and `MemDto` classes under `backend/services/shared/src/dto`
     alongside `DtoBase`.
   - Ensure both extend `DtoBase` and share common behavior where appropriate.

2. **Refactor persistence rails to require DbDto**

   - Update DbWriter/DbReader/DbDeleter signatures to accept only
     `DtoBag<DbDto>` (or `T extends DbDto`).
   - Add runtime assertions (where appropriate) to fail fast if a non-DbDto
     sneaks through via type holes.

3. **Migrate existing DTOs in phases**

   - Phase 1: Core infrastructure DTOs
     - `EnvServiceDto`
     - `SvcconfigDto`
     - Template CRUD entity DTOs (`t_entity_crud`)
   - Phase 2: Service-specific domain DTOs (User, Auth, etc.).
   - Phase 3: Review quark DTOs in pipelines and move them to MemDto where
     appropriate.

4. **Keep DtoBag semantics unchanged**  
   The DtoBag API remains the same. Its type parameter will simply clarify
   which “kind” of DTO is being carried (DbDto vs MemDto).

5. **Update documentation and LDDs**

   - Update DTO-related LDDs (e.g., LDD-22) to mention DbDto vs MemDto.
   - Clarify in SOP/LDD docs that persistence rails operate only on DbDto and
     that MemDto is the correct base for in-memory-only quark DTOs.

6. **Testing**
   - Add focused tests ensuring that DbWriter rejects MemDto at compile-time
     (and optionally runtime).
   - Add tests for a sample DbDto and MemDto to verify that existing DTO
     behaviors still work as expected.

## Alternatives Considered

### 1. Keep a single DtoBase and rely on discipline

We could leave DtoBase as the only DTO base type and simply “be careful” not
to persist quark DTOs or to access DB metadata where it does not apply.

**Rejected**:

- This relies entirely on human discipline and code review.
- It does not provide compile-time protection against misusing quark DTOs
  with persistence rails.
- It keeps the conceptual drift between “pure DTO” and “DB-aware DTO”.

### 2. Move all persistence metadata out of DTOs into an external mapping

We could remove collection names and other persistence metadata from DTOs and
store them in the registry or a separate mapping structure. DTOs would be
pure, and DbWriter/DbReader would consult the mapping instead.

**Rejected (for now)**:

- This would significantly increase complexity and indirection in the
  persistence rails.
- Most DTOs are DB-backed; an external mapping pushes truly canonical
  knowledge away from the DTOs into another layer, making debugging and
  reasoning harder.
- The current architecture already works well with DTOs owning their
  collection metadata; DbDto simply formalizes this reality more cleanly.

### 3. Replace generic rails with per-service clients (e.g., AuthClient.createUser())

We could move away from generic DbWriter/DbReader and instead use per-service
clients that know all paths and persistence behaviors.

**Rejected**:

- This is a large architectural shift away from the template-driven,
  DTO-first, generic CRUD rails that are a core NV design choice.
- It would increase duplication and reduce the mechanical nature of CRUD
  services.
- The goal is to clarify existing patterns, not to replace them wholesale.

## References

- SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
- LDD-00 — Shared CRUD Rails (Env-Backed Services)
- LDD-05 — DTO Registry & Indexing
- LDD-09 — Persistence Architecture
- LDD-22 — DTO & Contract Architecture
- ADR-0040 — DTO-Only Persistence via Managers
- ADR-0047 — DtoBag, DtoBagView, and DB-Level Batching
