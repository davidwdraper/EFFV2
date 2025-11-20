# LDD-05 — DTO Registry & Indexing (Full System-Level Treatment)

## 1. Purpose
This chapter describes the **DTO Registry** and the NV **Indexing System** — two tightly coupled mechanisms that guarantee predictable, contract-first persistence across all CRUD services.  

The DTO Registry determines:
- which DTO types a service supports,
- how each DTO is constructed,
- which MongoDB collection each DTO uses,
- how hydrators create DTO instances,
- what indexes must be present for correct CRUD behavior.

Indexes guarantee:
- deterministic uniqueness semantics,
- correct sorting & pagination,
- stable cursor logic,
- and predictable duplicate-key handling.

CRUD services cannot function correctly without a correct and deterministic registry.

---

## 2. Philosophy: Why the Registry Exists

Before v3:
- DTO constructors were scattered,
- collections were inferred dynamically,
- index creation was inconsistent,
- and different services drifted from a shared pattern.

The registry centralizes:
- DTO → constructor mapping,
- DTO → collection mapping,
- DTO → indexHints,
- DTO → hydrator binding.

This makes every CRUD service consistent.

---

## 3. Responsibilities of the Registry (Indented)

Registry:
  register(dtoType, dtoConstructor)
  store collection name rules
  expose listRegistered()
  expose getCtor(dtoType)
  expose getCollection(dtoType)
  expose getIndexHints(dtoType)
  create hydrators
  ensureIndexes()

---

## 4. Responsibilities of the Registry (ASCII)

register()
    ↓
dtoType → constructor
    ↓
hydrate(json) → new DTO()
    ↓
collection resolution
    ↓
indexHints
    ↓
ensureIndexes() → Mongo

---

## 5. DTO Registration Model

### 5.1 Explicit Registration Only
No reflection.  
No directory scanning.  
Every DTO must be explicitly registered:

```
registry.register("xxx", XxxDto);
```

### 5.2 Constructor Requirements
DTO constructors must implement:
- `fromJson(json, { validate: true })`
- `toJson()`
- `clone()`
- static `indexHints`

### 5.3 Duplicate Registration Errors
If a dtoType is registered twice:
- registry throws REGISTRY_DUPLICATE_DTO_TYPE.

---

## 6. Collection Naming Strategy

### 6.1 Default Collection
A CRUD service may define a default collection via EnvServiceDto vars:
- `NV_MONGO_COLLECTION`

This is used when:
- only one DTO type exists.

### 6.2 Per-DTO Collections
For multi-DTO services:
- each DTO defines its own collection key, e.g.:
  - `NV_COLLECTION_ENV_SERVICE_VALUES: "env-service-values"`

### 6.3 Deterministic Resolution
Registry resolves collection like:
1. Look for per-DTO key  
2. Else fallback to `NV_MONGO_COLLECTION`  
3. Else throw REGISTRY_COLLECTION_MISSING

---

## 7. Hydration Strategy

### 7.1 Purpose
Hydrators convert wire JSON → DTO instances.

### 7.2 Rules
- Must use DTO.fromJson(json, { validate: true })
- Must not mutate input
- Must produce immutable DTOs
- Must throw on validation failure

### 7.3 Bag Integration
When a create/read/list pipeline finishes:
- items[] hydrate into DTOs,
- DtoBag created from these items.

This guarantees consistency across services.

---

## 8. Indexing System (Deep Dive)

### 8.1 Why Indexes Matter
Indexes ensure:
- unique key enforcement,
- efficient queries,
- deterministic pagination,
- cursor consistency,
- correct duplicate-key semantics.

Without correct indexes:
- CRUD flows break unpredictably.

### 8.2 IndexHints Contract
DTO.indexHints is a static property:

```
static indexHints = [
  { fields: { "_id": 1 }, unique: true },
  { fields: { "slug": 1, "version": 1 }, unique: true }
];
```

Rules:
- Must describe *every* index required,
- Must not describe indexes that don’t exist,
- Must not be empty.

### 8.3 Index Naming
Mongo auto-generates names.  
Service does not depend on index names — only fields & uniqueness.

---

## 9. Index Creation Flow

### 9.1 Indented Diagram
ensureIndexes:
  gather DTO constructors →
  for each DTO:
    locate collection →
    read indexHints →
    call ensureIndexesForCollection() →
      build indexes in Mongo →
      verify uniqueness and existence →
  log completion

### 9.2 ASCII Diagram
registry.ensureIndexes()
       ↓
collect DTOs
       ↓
for each DTO:
    collection
    indexHints
       ↓
Mongo.createIndexes()
       ↓
verify
       ↓
done

---

## 10. Failure Modes

### 10.1 Missing Collection
If registry cannot determine collection:
- boot aborts: REGISTRY_COLLECTION_MISSING

### 10.2 Bad IndexHints
If indexHints does not match expected format:
- boot aborts.

### 10.3 Mongo Index Errors
Any Mongo error (network, permissions, invalid fields):
- boot aborts,
- service never listens.

This enforces fail-fast discipline.

---

## 11. Future Evolution

### 11.1 svcconfig Integration
Index-hint registration remains the same.  
Collection resolution may move into svcconfig in future.

### 11.2 Versioned Collections
Future major versions may use:
- <collection>_v2
- <collection>_v3

Registry will facilitate this.

### 11.3 Hot Reload of Index Hints
With dynamic svcenv reload, future index adjustments may be allowed, but require:
- versioning,
- migrations,
- replay-safe transitions.

---

## 12. Summary
The DTO Registry and Indexing System ensure NV CRUD services:
- hydrate DTOs correctly,
- persist data deterministically,
- enforce uniqueness,
- obey collection naming rules,
- and always boot with correct indexes.

Without this machinery, CRUD services would drift and become inconsistent.  
With it, NV services scale uniformly.

This completes the full deep-dive into the DTO Registry and Indexing subsystem.
