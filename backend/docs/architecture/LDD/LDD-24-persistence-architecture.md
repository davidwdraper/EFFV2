# LDD-24 — Persistence Architecture  
*(DbWriter, DbReader, Indexes, Collections, IDs, and Cursors)*

---

## 1. Purpose

This chapter defines the **persistence rails** for NV services:

- How services talk to the database via shared adapters  
- How DTOs are written, read, updated, and deleted  
- How collections, IDs, and indexes are determined  
- How duplicate keys and content conflicts are surfaced  
- How pagination and cursors behave  
- How env-service provides all DB configuration  

If DTOs define *what* we store, this chapter defines *how* we store and retrieve it safely.

---

## 2. Core Principles

1. **DTO-only persistence**  
   The only thing that goes to or comes from the database is a DTO (or a `DtoBag` of DTOs) that satisfies its contract.

2. **Adapters, not ad-hoc queries**  
   All DB access flows through shared adapters (`DbWriter`, `DbReader`, and friends). No raw driver calls scattered across controllers/handlers.

3. **Explicit collections**  
   Each DTO class defines its collection via `dbCollectionName()`. No guessing, no string concatenation in random files.

4. **Index hints are DTO-owned**  
   DTOs declare static `indexHints`. Index creation is centralized in `ensureIndexesForDtos`, never hidden in migrations or one-off scripts.

5. **Deterministic IDs**  
   ID semantics are consistent and enforced. Create, update, delete, and duplicate checks all behave the same way for a given DTO.

6. **env-service is the only config source**  
   DB URI, DB name, and per-DTO collection env vars come from env-service (via `EnvServiceDto`), not `.env` files.

---

## 3. Collections & Env Configuration

### 3.1 Collection Names

Each DTO declares:

```ts
public static dbCollectionName(): string {
  return "env-service-values"; // example
}
```

This is the **canonical** collection name for that DTO’s instances.

### 3.2 Env Variables & svcenv

Collections come from env-service via `EnvServiceDto.getEnvVar()`:

- `NV_MONGO_URI` — connection string  
- `NV_MONGO_DB` — DB name  
- For multi-DTO services, per-DTO collection env keys, e.g.:
  - `NV_COLLECTION_ENV_SERVICE_VALUES` = `"env-service-values"`

The adapter **never** hardcodes a collection name except as a fallback for template services where per-DTO keys haven’t been introduced yet. The long-term goal is: **all collections are env-driven**.

---

## 4. DbWriter — DTO → DB

`DbWriter<TDto>` is responsible for:

- writing DTOs to the correct collection  
- mapping DTO IDs to DB-native IDs as needed  
- handling duplicate-key errors in a standard way  
- returning DTOs (or bags) to handlers once writes are complete  

### 4.1 Construction

Conceptually:

```ts
const writer = new DbWriter<EnvServiceDto>({
  bag,            // DtoBag<TDto> to persist
  mongoUri,       // from EnvServiceDto
  mongoDb,        // from EnvServiceDto
  log,            // ILogger
});
```

OR, in newer flows:

```ts
const writer = new DbWriter<EnvServiceDto>({
  bag,
  svcEnv,         // EnvServiceDto (provides URI, DB, collections)
  log,
});
```

Adapters read env details from `svcEnv` using the agreed env keys.

### 4.2 Responsibilities

- **Insert** new DTOs on create  
- **Replace or upsert** on update (depending on design for the service)  
- **Delete** on delete flows  
- Return DTOs as DTOs, not raw DB documents

### 4.3 ID Handling

The ID story is locked in:

- DTO defines its ID field (e.g., `_id` as UUID string).  
- DbWriter **does not invent** extra ID semantics.  
- If the DB driver has its own `_id` column (e.g., Mongo’s ObjectId), mapping happens in a dedicated adapter layer so DTO contracts remain clean.

---

## 5. DbReader — DB → DTO

`DbReader<TDto>` is the symmetric adapter:

- runs queries against the DB  
- hydrates DTOs with `fromJson(json, { mode:"db" })`  
- groups DTOs into `DtoBag<TDto>`  

### 5.1 Common Operations

- `findById(id: string) → DtoBag<TDto>` (singleton bag or empty)  
- `findByFilter(filter, opts) → DtoBag<TDto>`  
- `findPage(filter, { limit, cursor }) → { bag, cursor }`  

### 5.2 Singleton Expectations

Handlers often expect singleton semantics:

- read-by-id  
- update-by-id  
- delete-by-id  

DbReader is allowed to return multiple matches (DB invariants might have drifted), but **handlers must enforce**:

- `bag.ensureSingleton()`  
- or `DtoBag.ensureSingleton()` helper  

If singleton expectations are violated, handlers must return a 500 or 409 depending on context.

---

## 6. Index Architecture

Indexes are declared on DTO classes as static hints:

```ts
export class XxxDto extends DtoBase {
  public static indexHints = [
    { keys: { _id: 1 }, options: { unique: true } },
    { keys: { bizField1: 1, bizField2: 1 }, options: { unique: true, name: "ux_xxx_business" } },
  ];
}
```

### 6.1 ensureIndexesForDtos

The shared helper:

- takes a list of DTO ctors  
- for each DTO:
  - reads `dbCollectionName()`  
  - reads `indexHints`  
  - calls the DB driver to ensure indexes exist  

This runs at **service boot** (inside `AppBase.onBoot()` via the registry), **before** any routes are mounted.

### 6.2 Invariants

- A service must not start if critical indexes cannot be created.  
- Index names that are meaningful (e.g., `"ux_xxx_business"`) are used later by duplicate-key parsers to map DB errors to NV-level codes like `DUPLICATE_CONTENT`.

---

## 7. Duplicate-Key & Conflict Semantics

Duplicate conditions come in two flavors:

1. **DUPLICATE_ID**  
   - DB index `_id` (or equivalent) is violated.  
   - Often indicates a collision on explicit or auto-generated ID.  

2. **DUPLICATE_CONTENT**  
   - A business-level unique index (e.g., `"ux_xxx_business"`) is violated.  
   - Indicates two DTOs with conflicting “business key” fields.

### 7.1 parseDuplicateKey

The shared parser inspects DB error objects:

- index name  
- offending key values  
- error message  

It returns a normalized structure that `ControllerBase.finalize()` maps to:

- `DUPLICATE_ID`  
- `DUPLICATE_CONTENT`  
- or generic `DUPLICATE_KEY`

### 7.2 Handler Expectations

Handlers never decode raw DB error messages themselves. They either:

- let DbWriter throw a structured `DuplicateKeyError`, or  
- pass raw error objects up to the controller, which calls `parseDuplicateKey`.

---

## 8. Pagination & Cursor Semantics

List operations use **cursor-based pagination** via DbReader.

### 8.1 Query Model

Typical list handler:

1. Parse `limit` and `cursor` from query.  
2. Build a DB query and sort order (e.g., `createdAt` ascending, `_id` tiebreaker).  
3. Execute query with `limit + 1` docs to detect “has more”.  
4. Build next cursor if more docs remain.  

### 8.2 Cursor Shape

Cursors are opaque strings, typically encoding:

- last document’s sort key(s)  
- maybe `_id` as tie-breaker  

Clients must never rely on cursor internals; they just pass back the string.

### 8.3 Invariants

- Cursors must be stable for the life of the underlying data snapshot.  
- Limit semantics are:
  - `limit <= MAX_LIMIT`  
  - if not specified, a sensible default is applied.  

Handlers must:

- return `{ items, meta: { limit, cursor } }`  
- never present inconsistent `count` vs `items.length` vs `cursor` metadata.

---

## 9. Read/Write Ordering & WAL

When WAL is active, the logical ordering is:

1. Prepare WAL entries (before/after DTO snapshots).  
2. Write WAL entries (or queue them to WAL writer).  
3. Write DTOs to DB via DbWriter.  

If WAL cannot be written:

- treat as **critical**  
- return 500  
- do not write DTOs (or mark system as degraded in future extensions).

DbWriter must either be:

- called **after** WAL flush, or  
- composed in a way that WAL writes and DB writes can be correlated deterministically.

---

## 10. Error Handling in Adapters

DbWriter/DbReader must **not**:

- talk to Express `req`/`res`.  
- construct Problem+JSON responses.  
- log sensitive payloads.  

Instead, they:

- throw typed errors (e.g. `DuplicateKeyError`, `DbConnectionError`)  
- or return `Result`-style objects consumed by handlers/controllers.

Controllers map these into HTTP semantics consistent with the error architecture (LDD-17).

---

## 11. Testing Persistence

Persistence tests must:

- create DTOs via `fromJson()` or registry helpers  
- write using DbWriter  
- assert:
  - correct collection  
  - correct index creation  
  - duplicate-key behavior (ID vs business key)  
  - cursor semantics for list operations  
  - round-trip (`fromJson → DbWriter → DbReader → toJson`)  

Env configuration in tests should be driven via mock EnvServiceDto or equivalent configuration DTOs, never raw `.env` parsing.

---

## 12. Anti-Patterns (Forbidden)

- Direct use of Mongo driver (or any DB client) from controllers, handlers, or DTOs.  
- Ad-hoc collection name strings in random files.  
- Index creation embedded in one-off scripts instead of the shared `ensureIndexesForDtos` flow.  
- Swallowing DB errors and returning 200 with “ok:false” style payloads.  
- Using offset-based pagination instead of cursor-based semantics for large collections.

---

## 13. Future Evolution

Possible future enhancements:

- Multi-tenant collection naming via env or svcenv config.  
- Cross-region write strategies (primary/replica semantics).  
- Soft-delete semantics via `deletedAt` field and filtered views.  
- Built-in archival helpers for cold data.  
- Pluggable storage backends behind the same DbWriter/DbReader interface (e.g., for search indexes or non-Mongo stores).

---

End of LDD-24.
