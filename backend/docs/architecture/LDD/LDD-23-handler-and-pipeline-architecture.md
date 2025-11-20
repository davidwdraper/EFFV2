# LDD-23 — Handler & Pipeline Architecture  
*(Per-Route Controllers, HandlerContext Bus, Pipelines, and Execution Rules)*

---

## 1. Purpose

This chapter defines how NV services **actually do work** once an HTTP request lands:

- How per-route controllers orchestrate flows  
- How `HandlerContext` acts as a KISS key/value bus  
- How handlers are structured, ordered, and executed as pipelines  
- How data and DTOs move through the pipeline (no side-channel magic)  
- How success, warnings, and errors are represented and surfaced  
- How this all ties into DTOs, DtoBags, DbReader/DbWriter, WAL, and Problem+JSON  

If DTOs and contracts define *what* the data looks like, the handler/pipeline architecture defines *how* requests are processed top-to-bottom.

---

## 2. Core Principles

1. **Per-route controllers**  
   Each route has a dedicated controller class (e.g., `XxxCreateController`), responsible only for orchestration, not business logic.

2. **Handler pipelines**  
   Controllers assemble **ordered lists of handlers**. Each handler performs exactly one concern (e.g., “populate bag from body”, “load existing from DB”, “apply patch”, “write to DB”).

3. **HandlerContext as the bus**  
   All cross-handler state lives in `HandlerContext`—a simple key/value store. Handlers only communicate by setting/getting values on the context.

4. **No side channels**  
   No global variables. No random references to Express `req`/`res` inside handlers. Everything is either:
   - in the context, or  
   - on the controller (for shared rails), or  
   - in shared utilities.

5. **Deterministic outcomes**  
   On every request, exactly one of the following states must be true at finalize:
   - success (`handlerStatus = "ok"`)  
   - warning (`handlerStatus = "warn"`)  
   - error (`handlerStatus = "error"`)

---

## 3. Controller Role

A controller’s responsibilities are:

- Build a `HandlerContext` from the inbound request.  
- Attach invariants such as `dtoType`, `op`, and `requestId`.  
- Seed DTO hydrators and any other common rails into the context.  
- Choose which pipeline to run (based on `dtoType`, route, or op).  
- Invoke `runPipeline()` and then `finalize()`.

### 3.1 Controller Anti-Responsibilities

Controllers **must not**:

- read/write directly from the database  
- perform DTO-level business logic  
- manually construct responses (except in “no pipeline registered” edge-cases)  
- use `res` directly, except via `finalize()`  

This keeps controllers orchestration-only and testable with narrow concerns.

---

## 4. HandlerContext Bus

`HandlerContext` is a simple key/value store with typed helpers:

- `set(key: string, value: unknown)`  
- `get<T>(key: string): T | undefined`  

### 4.1 Required Keys (Common)

Handlers and controllers agree on a **shared vocabulary** for keys. Common keys include:

- `"requestId"` — string  
- `"svcEnv"` — EnvServiceDto (env config)  
- `"dtoType"` — registry key for DTO type (e.g., `"xxx"`)  
- `"op"` — operation name (`"create" | "update" | "read" | "delete" | "list"`)  
- `"bag"` — current `DtoBag<IDto>` (canonical payload)  
- `"existingBag"` — bag of loaded DTOs from DB (for update/delete)  
- `"db.collectionName"` — resolved collection name for this DTO type  
- `"result"` — final success payload (if controller/handlers choose to set it)  
- `"handlerStatus"` — `"ok" | "warn" | "error"`

### 4.2 Response Keys

When a handler detects an error and wants to short-circuit:

- set `handlerStatus = "error"`  
- set `response.status = <HTTP code>`  
- set `response.body = { code, title, detail, issues? }`

`ControllerBase.finalize()` will turn this into a Problem+JSON.

---

## 5. Handler Structure

Each handler is a small class, typically:

```ts
export class SomeHandler extends HandlerBase {
  public async run(): Promise<void> {
    const ctx = this.ctx;

    // read from ctx
    const bag = ctx.get<DtoBag<IDto>>("bag");

    // do one focused thing...

    // write results / status back to ctx
    ctx.set("bag", updatedBag);
  }
}
```

### 5.1 Single Concern

Handlers must:

- focus on **one** stage: parse, hydrate, load, patch, persist, log, etc.  
- not attempt to “do everything” (no god-handlers)  

This enables re-use (e.g., the same BagPopulate handler across create/update/list flows).

---

## 6. Pipelines (Ordered Handlers)

Pipelines are defined in small index modules per operation + dtoType, for example:

```ts
// XxxCreate pipeline
export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  return [
    new BagPopulatePutHandler(ctx, controller),
    new XxxBusinessRulesHandler(ctx, controller),
    new BagToDbCreateHandler(ctx, controller),
  ];
}
```

### 6.1 Why Pipelines?

Pipelines:

- make request flows explicit and inspectable  
- are easy to test step-by-step  
- are easy to extend by adding/removing handlers in a single place  
- keep controllers thin and readable

---

## 7. Preflight & Pipeline Execution

`ControllerBase.runPipeline()` enforces a preflight before executing handlers:

1. Confirm `svcEnv` exists.  
2. Confirm registry available (if required).  
3. Confirm `dtoType` is set (if the route is dtoType-based).  
4. If any of these fail:
   - set `handlerStatus = "error"`  
   - set appropriate `response.status` and `response.body`  
   - skip handler execution.

### 7.1 Execution Rules

- Handlers run **in sequence** in a simple loop.  
- Handlers may set `handlerStatus = "error"` or `response.status ≥ 400`.  
- Once `handlerStatus` is `error`, later handlers **may still run** if they’re designed to (for logging/cleanup), but generally pipelines short-circuit by design.

---

## 8. Success, Warn, and Error States

### 8.1 Success (`"ok"`)

Default if no handler sets a status.  
Common pattern:

- `ctx.set("result", { items, meta })`  

`finalize()`:

- chooses `response.status` (default 200)  
- sends `result` as JSON  

### 8.2 Warning (`"warn"`)

Used when:

- the request succeeds but returns extra warnings.  
- e.g., partial results, degraded path, or deprecated usage.

Handlers:

- set `handlerStatus = "warn"`  
- optionally aggregate `warnings[]` into context  

`finalize()`:

- logs warnings via `log.warn`  
- returns `result` merged with `warnings`  

### 8.3 Error (`"error"`)

Used for any error condition:

- validation failures  
- duplicate keys  
- missing DTOs on read  
- unexpected internal failures  

Handlers set:

- `handlerStatus = "error"`  
- `response.status` (e.g., 400, 409, 500)  
- `response.body` with partial or full error object  

`finalize()` normalizes to a Problem+JSON response, including requestId.

---

## 9. Data Flow Examples

### 9.1 CREATE Flow

Typical create pipeline:

1. **BagPopulatePutHandler**
   - parse JSON body  
   - hydrate DTOs via registry hydrator (`fromJson(mode:"wire", validate:true)`)  
   - wrap into `DtoBag`

2. **XxxBusinessRulesHandler**
   - enforce any create-time invariants  
   - e.g., required fields beyond contract, cross-field rules  

3. **PrepareAuditCreateHandler (optional)**
   - build WAL entries for “after” state  

4. **BagToDbCreateHandler**
   - call DbWriter with bag  
   - handle DB errors including duplicate key  
   - push final DTO(s) into `ctx["bag"]` or `ctx["result"]`  

5. **Finalize**
   - respond with `items[]` and optional `meta`  

### 9.2 UPDATE Flow

Typical update pipeline:

1. **BagPopulatePatchHandler**
   - parse JSON body  
   - hydrate patch DTO(s)  

2. **LoadExistingUpdateHandler**
   - load existing DTO(s) via DbReader  
   - store into `existingBag`  

3. **ApplyPatchUpdateHandler**
   - for each DTO:
     - clone existing  
     - apply `patchFrom` using inbound patch JSON  
   - store updated DTOs into `bag`  

4. **PrepareAuditUpdateHandler**
   - generate WAL entries with `{ before, after }`  

5. **BagToDbUpdateHandler**
   - persist updated DTOs  

6. **Finalize**
   - return updated DTO(s) via standard envelope  

### 9.3 LIST Flow

Typical list pipeline:

1. **BagPopulateListQueryHandler**
   - parse query (`limit`, `cursor`, etc.)  

2. **DbReadListHandler**
   - load DTOs using DbReader  
   - build `DtoBag`  

3. **BuildMetaListHandler**
   - set `meta` fields on context (`limit`, `cursor`, `count`)  

4. **Finalize**
   - respond with `{ items: bag.toJsonArray(), meta }`  

---

## 10. Handler Error Patterns

Handlers must **never** directly call `res.status().json()`.

Instead, on error:

1. They construct a **data-only** error description.  
2. Set context keys:
   ```ts
   ctx.set("handlerStatus", "error");
   ctx.set("response.status", 400);
   ctx.set("response.body", {
     code: "VALIDATION_FAILED",
     title: "Bad Request",
     detail: "payload failed validation",
     issues,
   });
   ```
3. Return control to the controller.  

`finalize()` then:

- maps this into Problem+JSON  
- attaches `requestId`  
- logs appropriately

This keeps HTTP semantics centralized in one place (ControllerBase).

---

## 11. Composition & Reuse

Common shared handlers live in `@nv/shared/http/handlers` and are reused by all services:

- `BagPopulateGetHandler`  
- `BagPopulatePutHandler`  
- `BagPopulatePatchHandler`  
- `DbReadByIdHandler`  
- `DbReadListHandler`  
- `BagToDbCreateHandler`  
- `BagToDbUpdateHandler`  
- `BagToDbDeleteHandler`  
- `PrepareAudit*Handler` variants  

Services may define service-specific handlers in their own folders, but must prefer reuse when possible.

---

## 12. Anti-Patterns (Forbidden)

- Handlers that:
  - read `process.env`  
  - talk directly to SvcClient (except designated integration handlers)  
  - embed DB queries inline instead of using DbWriter/DbReader  
  - mutate DTO fields directly instead of using DTO methods  
  - call `res` directly or bypass `finalize()`

- Pipelines that:
  - exceed reasonable length with many mixed concerns (should be decomposed)  
  - rely on implicit context keys never documented or set in controllers  

- Controllers that:
  - try to do data access or business logic directly  
  - skip `runPipeline()` and `finalize()` for “just this one route”  

---

## 13. Testing Pipelines

Tests for pipelines should:

- construct a fresh `HandlerContext`  
- optionally seed DTOs or bags directly  
- build the same pipeline list as the controller would  
- run handlers in order, asserting:
  - context keys set  
  - expected `handlerStatus`  
  - final `bag` contents  
  - error/warning behavior  

This allows testing without Express or actual HTTP requests.

---

## 14. Future Evolution

Potential improvements:

- Typed context keys (e.g. using branded string literals or helper accessors).  
- Explicit pipeline descriptors (JSON) for introspection and documentation.  
- Visualization tools to show cross-service handler flows.  
- Handler-level profiling (time per handler with requestId).  

---

End of LDD-23.
