# LDD-08 — Bag & BagView Architecture (Full Deep Dive)

## 1. Purpose

DtoBag and DtoBagView provide the immutable in‑memory structures used across all NV services for:
- inbound wire hydration
- outbound wire serialization
- DB batching
- deterministic pagination
- cursor‑based listing
- unit-of-work semantics
- handler purity guarantees

They are core to ADR‑0047 and the newer wire-envelope model (ADR‑0050).

---

## 2. DtoBag — Immutable Master Collection

DtoBag<T> is:
- an **ordered**, **immutable** array of DTOs
- the sole container type passed between handlers
- the canonical representation of items in wire responses
- the input/output of persistence layers (DbWriter, DbReader)

### 2.1 Invariants
- Always non-null.
- Always an array.
- Never mutated in place.
- New bags are created via constructors only.
- All DTOs inside must already have:
  - validated contract
  - assigned collectionName
  - canonical `id`

### 2.2 Construction Rules
DtoBag is constructed only via:
- `new DtoBag([...])` inside handlers
- DtoRegistry hydrators
- DbReader (read paths)
- SvcEnvClient (for env-service config bags)

Controllers never construct bags directly.

---

## 3. Wire Envelope Semantics

Per ADR‑0050:
Wire responses use:

```
{
  "items": [ { id, ...fields }, ... ],
  "meta": { ... }
}
```

DTOs are already final JSON shapes; no nested `doc`.

### 3.1 Meta Rules
- meta is optional.
- Standard fields: cursor, limit, nextCursor, totalCount.
- Handlers write meta only for list endpoints.

---

## 4. Bag Purity (ADR‑0053)

Purity requirements:
- No handler may mutate an existing bag.
- No handler may mutate DTOs returned by a bag.
- All transforms produce a **new** DtoBag.
- No monkey-patching DTOs.

### 4.1 Why Purity Matters
- Handlers become replayable.
- WAL-first semantics become deterministic.
- Tests remain stable.
- Audit logs can diff DTOs safely.
- Pagination becomes reproducible.

---

## 5. DtoBagView — Read-Only Lens

DtoBagView is a lens for:
- filtering  
- sorting  
- slicing  
- cursoring  

### 5.1 Invariants
- Does not own DTOs.
- Does not mutate parent bag.
- Purely functional; returns new arrays or pagination snapshots.

### 5.2 Workflow Example
```
const view = bag.view();
const page = view
  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  .slice(0, 25)
  .toWire();
```

---

## 6. Cursor Semantics

Cursor format is deterministic:
- Base64-encoded JSON
- Contains stable key: id or index
- Decoding must not throw; invalid cursor → 400 Bad Request

### 6.1 Pagination Invariants
- limit must always be honored unless > maxLimit
- nextCursor appears only when more items remain
- last page omits nextCursor entirely

---

## 7. Bag-Level Singletons

Shared rules:
- `.getSingleton()` returns exactly one DTO or throws
- `.ensureSingleton()` throws with problem-code details
- Handlers for create/update/read must enforce singleton results

### 7.1 Why Singletons Matter
- Prevents mistakes where handlers operate on multi-item bags
- Ensures CRUD operations remain deterministic
- Avoids ambiguous persistence semantics

---

## 8. DTO Immutability Contract

DTOs inside bags must:
- never be mutated directly
- use dto.clone() to produce updated copies
- use dto.patchFrom() when applying wire patches
- maintain stable `_id`

### 8.1 Patch Flow (Update)
```
existing = existingBag.getSingleton();
patched = existing.clone();
patched.patchFrom(patchJson);
return new DtoBag([patched]);
```

---

## 9. Bag-to-DB Persistence

DbWriter integrations use:
- DtoBag as input (always singleton for CRUD)
- validated DTOs only
- deterministic id handling
- retry-on-duplicate for _id collisions
- collectionName from registry

### 9.1 Invariants
- Never pass raw objects.
- Never pass arrays of mixed DTO types.
- Always pass proper DtoBag<T>.
- DbWriter returns new DtoBag or id depending on operation.

---

## 10. BagPopulate Handlers (Hydration Layer)

BagPopulateGetHandler / BagPopulatePutHandler:
- parse inbound wire JSON
- ensure items is an array
- hydrate via registry.hydratorFor()
- apply validation ({ validate:true })
- produce ctx["bag"]

### 10.1 Error Modes
- malformed JSON → 400
- contract violation → 400 with issues[]
- missing items array → 400

---

## 11. BagView Integration for LIST Pipelines

LIST pipelines use:
1. DbReader to fetch full bags (filtered by dtoType)
2. BagView for slicing/pagination
3. Build wire envelope for outbound list route

### 11.1 Meta Construction
```
meta = {
  limit,
  cursor,
  nextCursor,
  count
}
```

---

## 12. Envelope Round-Trip Rules

Every DtoBag must safely:
- toWire() —> { items, meta }
- fromWire() —> rehydrated bag

Invariants:
- No loss of id
- No loss of collectionName
- No zod violations

---

## 13. Testing Rules (Smoke Suite)

Smoke expectations:
- All CREATE/UPDATE/DELETE operations round-trip via DtoBag
- LIST must verify cursor consistently
- All bags must strip internal fields (secret tokens, ctorSecret, etc.)
- No legacy `doc` envelope

---

## 14. Future Extensions

- Bag diffing for WAL
- Bag transcoding (JSON → BSON → JSON)
- Encrypted bag storage for regulated services
- Bag merging for composite endpoints
- Distributed cursoring with partition keys

---

End of LDD-08.
