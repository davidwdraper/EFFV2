# LDD-06 — Controller & Pipeline Architecture (Full Deep Dive)

## 1. Purpose

Controllers, pipelines, and handlers form the execution spine of every NV CRUD-style service. This chapter describes:
- The responsibilities and invariants of controllers
- The structure and behavior of HandlerContext
- Deterministic pipelines as ordered sequences of handlers
- Handler purity and error propagation
- DTO registry hydration and seeding
- Finalization rules (Problem+JSON normalization)
- How CRUD operations compose these parts consistently
- How multi-operation controllers use `:op` routing to select pipelines

---

## 2. Controller Architecture

Controllers are thin orchestrators responsible for:
1. Creating a HandlerContext
2. Stamping `dtoType`, `op`, `id`, `collectionName`
3. Seeding the correct hydrator
4. Selecting the correct pipeline
5. Running the pipeline
6. Delegating final response building to `ControllerBase.finalize()`

### 2.1 Invariants
- No business logic lives in controllers.
- Controllers must never mutate DTOs.
- Controllers must not perform DB operations.
- All DTO hydration is delegated to registry.hydratorFor().
- Controllers must always stamp `ctx["dtoType"]` and `ctx["op"]`.

---

## 3. HandlerContext

HandlerContext is a structured bus:
- key/value storage (immutable DTOs allowed)
- seeded by makeContext()
- enriched by controllers (dtoType, op, id)
- read/write by handlers

### 3.1 Invariants
- Keys must be well-named and namespaced (`hydrate.fromJson`, `db.collectionName`)
- `ctx["svcEnv"]` must exist by the time pipelines run
- `ctx["bag"]` always holds a DtoBag once populated
- `ctx["existingBag"]` holds a DtoBag for update/read/delete

---

## 4. Pipelines

A pipeline is an ordered list of HandlerBase instances.

Example:
1. BagPopulateGetHandler
2. LoadExistingHandler
3. ApplyPatchHandler
4. BagToDbHandler

### 4.1 Determinism
- Handlers run in strict order.
- No branching inside handlers.
- All branching occurs at controller level via pipeline selection.

---

## 5. Handlers

Handlers own the smallest unit of work:
- always synchronous in intent, async in implementation
- exactly one domain action
- never modify context outside their scope
- must set `ctx["handlerStatus"]` on errors

HandlerBase.run() guarantees:
- logging entry/exit
- consistent error trapping
- safe mutation patterns

---

## 6. Hydration

Hydration is performed by hydrator functions stored in `ctx["hydrate.fromJson"]`.  
These originate from the dto registry and enforce:
- DTO contract validation (zod layer)
- collectionName seeding
- mode:"wire" behavior for inbound JSON

---

## 7. Pipeline Steps (CRUD Examples)

### 7.1 CREATE
- BagPopulatePutHandler
- EnforceSingletonHandler
- BagToDbCreateHandler

### 7.2 READ
- LoadExistingReadHandler
- ReturnExistingHandler

### 7.3 UPDATE
- BagPopulateGetHandler
- LoadExistingUpdateHandler
- ApplyPatchUpdateHandler
- BagToDbUpdateHandler

### 7.4 DELETE
- LoadExistingDeleteHandler
- BagToDbDeleteHandler

---

## 8. Finalization

finalize() inspects:
- handlerStatus (`ok`, `warn`, `error`)
- result / response.body
- warnings[]
- parseDuplicateKey() for Mongo errors

### 8.1 Problem+JSON
```
{
  "type": "about:blank",
  "title": "...",
  "detail": "...",
  "status": <number>,
  "code": "DUPLICATE_ID" | "DUPLICATE_CONTENT" | ...,
  "issues": [...]?,
  "requestId": "..."
}
```

---

## 9. Registry Integration

Controllers rely on registry.hydratorFor(dtoType) to:
- map type keys → DTO constructors
- seed per-type collection names
- hydrate with mode:"wire"

Registry invariants:
- no fallback types
- explicit constructor map only
- stable dbCollectionName per DTO

---

## 10. Error Propagation

Handlers may set `ctx["handlerStatus"]="error"` and populate:
- ctx["response.status"]
- ctx["response.body"]

The pipeline halts immediately; finalize() maps the error.

Duplicate key logic:
- parseDuplicateKey() inspects the Mongo error
- maps index → internal code

---

## 11. Logging

Per SOP:
- logging must include requestId
- each handler logs entry, exit, errors
- controllers log pipeline selection
- finalize logs outcome category

---

## 12. Future Extensions

- Streaming pipelines (cursor-based)
- Pluggable validation layers
- Dynamic pipeline selection
- WAL-integrated handlers
- Policy gates via `ctx["policy.*"]`

---

# 13. Multi-Operation Controllers with `:op` Routing

NV services often support *multiple logical operations* under a single CRUD family.  
Examples:
- env-service: `create` vs `clone`
- svcconfig: `list` vs `mirror`

Instead of adding controllers or proliferating routes, NV uses:

```
GET /:dtoType/:op
```

### 13.1 Route Pattern

Example:
```ts
r.get("/:dtoType/:op", (req, res) => listCtl.get(req, res));
```

The route:
- contains no logic
- performs no switching
- does not validate op
- delegates to controller

### 13.2 Controller Responsibilities

A multi-op controller must:
1. Read `dtoType`
2. Read `op`
3. Stamp both in context:
   ```ts
   ctx.set("dtoType", dtoType)
   ctx.set("op", op)
   ```
4. Seed hydrator once
5. Switch `(dtoType → op)`
6. Select pipeline
7. Run pipeline
8. finalize()

### 13.3 Example

```ts
switch (dtoType) {
  case "svcconfig": {
    switch (op) {
      case "list":
        run(listPipeline)
      case "mirror":
        run(mirrorPipeline)
    }
  }
}
```

### 13.4 Invariants

- Only controllers choose pipelines.
- Handlers never branch.
- Pipelines never import each other.
- Pipelines remain linear and deterministic.

### 13.5 Why `:op` Matters

Allows:
- Extended CRUD behavior
- Zero route sprawl
- Zero controller duplication
- Deterministic pipeline branching

### 13.6 When to Add a New `op`

Use a new op when:
- The behavior is not standard CRUD
- A different handler sequence is required
- DTO type stays the same
- Operation belongs to same route family

Do **not** use a new op when:
- A pipeline merely needs refinement
- A handler can be reused with no branching

---

End of LDD-06.
