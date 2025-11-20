# LDD-09 — Persistence Architecture (DbWriter, DbReader, Adapters, Retry Logic)

## 1. Purpose

The persistence layer provides the durable storage interface for all NV CRUD services.  
This chapter covers:

- DbWriter (write paths: create, update, delete)
- DbReader (read paths: by-id, list, filtered queries)
- Mongo adapters (index hints, collection resolution)
- Retry logic (duplicate _id handling)
- WAL-first considerations
- Error normalization
- How persistence integrates with bags, DTOs, and handlers

---

## 2. Architectural Goals

1. **DTO‑only persistence**  
   Storage operations work exclusively with DTOs, never raw JS objects.

2. **No schema drift**  
   DTO contracts (Zod) define the shape; persistence stores exactly that.

3. **Deterministic collection mapping**  
   Collection names come from DTO.dbCollectionName(), injected by registry.

4. **Centralized error handling**  
   Duplicate key errors must be fully normalized and surfaced via ControllerBase.

5. **Unit‑of‑work clarity**  
   Bags entering DbWriter must be validated, singleton (for CRUD), and immutable.

---

## 3. DbWriter — The Write Adapter

DbWriter is responsible for all mutations:
- create  
- update  
- delete  

It takes:
- `{ bag, mongoUri, mongoDb, log }`
- bag: must be a singleton for CRUD operations.

### 3.1 Create Flow
1. Extract DTO from bag.ensureSingleton().
2. Validate DTO fields.
3. Ensure id exists; generate UUID if absent.
4. Write to Mongo.
5. On duplicate _id:
   - retry up to 3 times with new UUIDs
   - if still duplicate → throw DuplicateId error

### 3.2 Update Flow
1. Extract existing DTO id from existingBag.
2. Extract patched DTO from ctx["bag"].
3. Replace the record in Mongo via `updateOne({_id}, {$set: dto.toJson()})`.
4. Must enforce upsert:false.
5. If record not found → NOT_FOUND error.

### 3.3 Delete Flow
1. Extract id from context.
2. `deleteOne({_id})`
3. Must be idempotent:
   - deleting nonexistent record still returns `{ ok:true }`.

### 3.4 Invariants
- Never write multiple items at once.
- Never mutate DTOs directly.
- Always log collection, id, and requestId.
- Always return a fresh bag or `{ok:true}` object.

---

## 4. DbReader — The Read Adapter

DbReader supports:
- read‑by‑id
- list via full collection scan + BagView
- projected queries (future)

### 4.1 Read by Id
- Takes `{ id, collectionName }`
- Returns a singleton bag or throws NOT_FOUND.

### 4.2 List
Flow:
1. Fetch all DTOs for the given collection.
2. Hydrate via registry.hydratorFor().
3. Wrap in DtoBag.
4. Use BagView for pagination.

### 4.3 Invariants
- Reader must never mutate DTOs.
- Must always return DtoBag.
- Must apply DTO validation on hydration.

---

## 5. Mongo Adapters & Index Hints

DTO classes declare:
```
static indexHints = [
  { keys: { _id: 1 }, options: { unique: true } },
  { keys: { business: 1 }, options: { unique: true } },
  ...
]
```

### 5.1 ensureIndexesForDtos()
- Called at AppBase boot.
- Reads indexHints from all DTOs in registry.
- Creates indexes on each collection.
- Fails fast on any index creation error.

### 5.2 Invariants
- boot must not proceed if indexes fail.
- duplicate index definitions must error early.
- names must remain stable across versions.

---

## 6. Duplicate Handling Logic

Duplicate errors come in three forms:
- _id collision
- unique business field collision
- compound unique index collision

### 6.1 parseDuplicateKey()
Normalizes raw Mongo errors to:
- index name
- fields
- final NV code:
  - DUPLICATE_ID
  - DUPLICATE_CONTENT
  - DUPLICATE_KEY

### 6.2 Retry Rules
CREATE operations handle _id collisions by retrying UUID generation:
- 3 retries
- exponential jitter (future)
- business collisions never retry; return 409

---

## 7. Persistence + Bag Integration

Handlers never touch Mongo directly.

Flow (create example):
1. BagPopulatePutHandler → bag
2. EnforceSingletonHandler → bag.ensureSingleton()
3. BagToDbCreateHandler → DbWriter
4. DbWriter returns a fresh bag or `{ok:true, id}` structure

### 7.1 Why Bags Matter
- Provide consistent unit of work
- Simplify testing
- Preserve ordering for list endpoints
- Keep DTO immutability guaranteed

---

## 8. Error Surface Areas

Persistence may throw:
- DuplicateId
- DuplicateContent
- ConnectionError
- ValidationError
- NotFound (update/delete/read)

All are mapped to Problem+JSON via ControllerBase.finalize().

---

## 9. Logging Rules

Every write must log:
- op: create/update/delete
- dtoType
- id
- collection
- requestId
- mongoUri (masked)
- timing (future)

Every read must log:
- op: read/list
- collection
- resultCount

---

## 10. Future Extensions

- Full WAL-first persistence
- Distributed writes with shard keys
- Versioned collection migration
- Bulk create support (for non-CRUD services)
- Query planner with BagView filters
- Cache layer (read-through, write-behind)

---

End of LDD-09.
