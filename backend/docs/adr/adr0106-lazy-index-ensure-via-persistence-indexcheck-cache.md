adr0106-lazy-index-ensure-via-persistence-indexcheck-cache

## Context

NV previously attempted to ensure MongoDB indexes during service boot
(AppBase → performDbBoot → registry.ensureIndexes). This created multiple
architectural failures:

- Services attempted to ensure indexes for collections they do not own.
- Registry logic was polluted with persistence concerns.
- Boot-time index ensure tightly coupled services, DTOs, and persistence.
- Failures were noisy, misleading, and cross-service in scope.

NV’s actual invariant is simpler and stricter:

> Indexes must be ensured **before a DB DTO is used for a DB operation**.

This does **not** require service boot choreography.

Additionally, NV introduced **SvcRuntime (ADR-0080)** specifically to avoid
passing env, logging, identity, and infrastructure dependencies through
every call stack. Persistence logic that ignores SvcRuntime and instead
accepts individual parameters reintroduces the very coupling SvcRuntime
was designed to eliminate.

This ADR defines a corrected persistence-layer design:

- Index ensure is **lazy**
- Index ensure is **once per collection per DB per process**
- Index ensure is enforced **at the DB boundary**
- All runtime dependencies are obtained **via SvcRuntime**

## Decision

### 1. Remove all index logic from service boot and from the Registry

- AppBase boot MUST NOT ensure indexes.
- `performDbBoot()` MUST NOT call any index-related logic.
- `DtoRegistry` MUST NOT:
  - import Mongo
  - read env configuration
  - ensure indexes
  - track persistence state

The Registry remains a pure DTO creation vocabulary.

---

### 2. Index ensuring is a lazy persistence-boundary concern

Indexes are ensured **only when a DB operation is about to occur**, not at
service startup.

All DB operation entry points (DbReader, DbWriter, and any shared DB
workers/managers) MUST ensure indexes **before performing a DB operation**.

This guarantees correctness without boot-time coupling.

---

### 3. Introduce IndexCheckCache (process-local, persistence-owned)

Create a shared persistence-layer cache:

**IndexCheckCache**

- Tracks index ensure state
- Prevents duplicate ensure work
- Prevents concurrent index storms

Cache keys MUST include:

- mongoUri
- resolved dbName (DB_STATE-aware)
- collectionName
- indexSignature (structure-based; excludes index name)

IndexCheckCache:

- is pure (no SvcRuntime)
- stores completed and in-flight ensures
- is owned exclusively by the persistence layer

DTOs MUST NOT track index ensure state.

---

### 4. Introduce IndexGate (SvcRuntime-integrated)

Create an **IndexGate** component that:

- Lives in the persistence layer
- Is constructed once per service process
- Is exposed via **SvcRuntime capability**
- Uses IndexCheckCache internally

IndexGate responsibilities:

- Resolve Mongo connection and DB name (via SvcRuntime)
- Group index hints by collection
- Compute index structure signatures
- Consult IndexCheckCache
- Ensure indexes via MongoDB APIs
- Log ensure operations with service context
- Fail fast on index structure conflicts

IndexGate is the **only** place where:

- Mongo
- env configuration
- logging
- index logic
  are allowed to intersect.

---

### 5. All DB operations MUST go through SvcRuntime

Persistence entry points MUST accept either:

- `rt: SvcRuntime`, or
- a `DbContext` derived once from `rt`

Passing individual parameters (envDto, mongoUri, dbName, log, etc.)
is forbidden.

SvcRuntime MUST provide persistence capabilities, such as:

- `db.client` or `db.clientFactory`
- `db.indexGate`

This ensures:

- consistent configuration
- no parameter sprawl
- correct env/log identity
- future extensibility (transactions, tracing, retries)

---

### 6. DTO responsibilities remain declarative only

DB DTOs provide:

- `static dbCollectionName(): string`
- `static indexHints: ReadonlyArray<IndexHint>`

DB DTOs MUST NOT:

- access SvcRuntime
- access Mongo
- read env configuration
- track index ensure state
- perform side effects

DTOs declare requirements; persistence enforces them.

---

### 7. Index matching semantics: structure over name

Index ensure logic MUST:

- ignore index name mismatches
- compare index **structure**, not names

Structure includes:

- fields and order
- uniqueness
- index kind (lookup, unique, text, hashed, ttl)
- TTL seconds
- materially relevant options
  (e.g., sparse, partialFilterExpression, collation)

If an existing index conflicts by structure:

- the DB operation MUST fail
- error message MUST be actionable
- failure is deterministic and local

---

### 8. Logging and failure behavior

On first index ensure for a collection:

- Log a single “index ensure begin” event
- Include:
  - service
  - envLabel
  - dbName
  - collectionName
  - DTO ctor(s) involved

On success:

- Log created/validated indexes once

On failure:

- Throw an error that includes:
  - db + collection
  - required index signature summary
  - detected conflict summary
  - ops remediation guidance

Failures occur at first DB use rather than boot. This is acceptable and
reduces system coupling while preserving correctness.

---

## Consequences

### Positive

- No cross-service index checking
- Registry remains pure and stable
- Boot logic is simplified
- Index ensure cost is paid once, lazily
- SvcRuntime is fully leveraged as intended

### Tradeoffs

- Index failures surface at first DB use
- First DB access incurs one-time latency
- Optional warm-up hooks may still be desired but are not required

---

## Implementation Notes

- IndexCheckCache:
  - `shared/src/persistence/indexes/IndexCheckCache.ts`
- IndexGate:
  - constructed once
  - stored as `rt` capability (e.g., `db.indexGate`)
- DbReader / DbWriter:
  - MUST invoke IndexGate before DB operations
  - MUST NOT bypass SvcRuntime

---

## Alternatives Considered

1. Boot-time index ensure  
   Rejected due to coupling and cross-service failures.

2. DTO-level index ensure  
   Rejected due to dependency inversion and runtime pollution.

3. Offline migration only  
   Rejected because NV requires runtime correctness guarantees.

---

## References

- ADR-0045 (Index Hints — boot ensure) — superseded
- ADR-0074 (DB_STATE invariants)
- ADR-0080 (SvcRuntime)
- ADR-0102 (Registry sole DTO creation authority)
