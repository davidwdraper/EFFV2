# LDD-07 — Handler Layer Deep Dive (Complete)

## 1. Purpose

This chapter defines the handler layer in full detail:
- Shared handlers (bag.populate, bag.to.db, loadExisting, applyPatch…)
- HandlerBase semantics
- Deterministic execution model
- Context contracts
- Error propagation
- Logging discipline
- Validation, patching, and persistence rules

## 2. HandlerBase Architecture

Handlers are the smallest units of business logic.  
They:
- execute one tightly scoped action
- mutate HandlerContext safely
- never catch errors silently
- rely on ControllerBase.runPipeline for sequencing

### 2.1 HandlerBase.run()

Guarantees:
- structured logging (entry/exit)
- propagation of thrown errors as handlerStatus="error"
- safe short‑circuiting (pipeline stops)

## 3. Shared Handler Catalog

### 3.1 BagPopulateGetHandler
Populates ctx["bag"] from:
- inbound GET/READ JSON payload (wire items)
- hydrates via ctx["hydrate.fromJson"]
- enforces array semantics (items:[])

Invariants:
- always produces a DtoBag
- must set ctx["bag"]  
- must respect { validate:true }

### 3.2 BagPopulatePutHandler
Same as above, but tailored for CREATE semantics and PUT verbs.

### 3.3 LoadExistingReadHandler
Loads an existing DTO by id, writing to:
- ctx["existingBag"]
- error if not found

Invariants:
- id must be canonical (ctx["id"])
- resulting bag must be singleton

### 3.4 LoadExistingUpdateHandler
Same but used for UPDATE flows.  
Ensures the existing DTO is loaded before patch is applied.

### 3.5 ApplyPatchUpdateHandler
Steps:
1. Take inbound patch bag (ctx["bag"])
2. Take existing DTO (ctx["existingBag"])
3. Apply dto.patchFrom()
4. Write updated DTO to ctx["bag"]

Invariants:
- patch must validate against contract
- clone() is owned by DTOBase; handler never mutates existing

### 3.6 BagToDbCreateHandler
Writes the inbound DTO to Mongo:
- generates id if absent
- respects retry rules for duplicate _id
- sets ctx["result"] with { ok:true, id }

### 3.7 BagToDbUpdateHandler
Persists the patched DTO:
- uses _id extracted from existingBag
- validates final shape
- sets ctx["result"]

### 3.8 BagToDbDeleteHandler
Removes the DTO from the database:
- must be idempotent
- success = { ok:true }

### 3.9 ReturnExistingHandler
Used in READ:
- simply copies existingBag → result

---

## 4. HandlerContext Contract

Keys used across handlers:
- requestId
- dtoType
- id
- bag (DtoBag inbound/updated)
- existingBag
- db.collectionName
- svcEnv
- hydrate.fromJson
- op
- response.status / response.body
- handlerStatus

Invariants:
- handlers must not delete keys
- handlers may add keys only in their namespace
- handlers must not mutate DTOs in place

---

## 5. Error Model

### 5.1 handlerStatus
Values:
- "ok" → continue
- "warn" → continue; finalize with warnings
- "error" → short‑circuit pipeline

### 5.2 How errors propagate
- Throw → caught by run() → handlerStatus="error"
- Or a handler sets response.status + response.body + handlerStatus="error"

### 5.3 Finalization behavior
ControllerBase.finalize() will:
- normalize duplicate errors
- map to Problem+JSON
- produce deterministic JSON output

---

## 6. Logging

Every handler logs:
- entry ({ handler, requestId })
- exit ({ handler, requestId })
- errors ({ handler, requestId, err })

Pipeline logging shows:
- pipeline selection
- handler order
- result or failure

---

## 7. CRUD Pipeline Examples (Detailed)

### 7.1 CREATE
1. BagPopulatePutHandler  
2. EnforceSingletonHandler  
3. BagToDbCreateHandler  
4. finalize()

### 7.2 READ
1. LoadExistingReadHandler  
2. ReturnExistingHandler  
3. finalize()

### 7.3 UPDATE
1. BagPopulateGetHandler  
2. LoadExistingUpdateHandler  
3. ApplyPatchUpdateHandler  
4. BagToDbUpdateHandler  
5. finalize()

### 7.4 DELETE
1. LoadExistingDeleteHandler  
2. BagToDbDeleteHandler  
3. finalize()

---

## 8. Patching Discipline

- Only update handlers may mutate DTOs
- Patch must use dto.patchFrom()
- Full DTO contract validation occurs after patch
- DTO fields must remain immutable outside patch boundaries

---

## 9. Persistence Layer Interaction

Handlers never:
- manage Mongo connections
- define indexes
- pick collection names

They rely entirely on:
- ctx["db.collectionName"]
- registry.hydratorFor()
- shared DbWriter adapter

DbWriter invariants:
- write-only path
- always returns fresh DTO or id
- duplicate handling via retry logic
- type-safe constraints

---

## 10. Future Extensions

- Policy handlers (ctx["policy.*"])
- Cross‑record transactional handlers
- WAL‑first semantics for all mutations
- Retry decorators
- Middleware-like pre/post handlers
- Streaming cursor handlers for LIST

---

End of LDD‑07.
