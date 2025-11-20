# LDG-04 — t_entity_crud Controller & Handler Pipeline Architecture

## 1. Purpose
This LDG describes the **controller architecture**, **handler pipeline design**, and **execution flow** inside the `t_entity_crud` service.  
These rails apply identically to all cloned NV services.

Controllers are intentionally thin.  
Handlers do the work.  
Pipelines enforce order and determinism.

This is the backbone of NV’s request-processing model.

---

## 2. Controllers: Thin Coordination Layer

### 2.1 Responsibilities
Controllers do three things — **and only three**:

1. Instantiate a fresh `HandlerContext`  
2. Validate request parameters required for routing (e.g., `dtoType`)  
3. Build and execute the correct handler pipeline

They do *not* implement business logic or persistence.  
They behave like traffic cops: directing flow, not driving the cars.

---

## 3. HandlerContext
Each request receives a dedicated `HandlerContext` instance.

### Context stores:
- parsed input  
- instantiated DTO(s)  
- repo results  
- metadata (pagination, counts, etc.)  
- requestId  
- service slug  
- DTO constructor  
- any intermediate values needed by downstream handlers  

The context is the “shared clipboard” for the whole pipeline.

---

## 4. Handler Pipeline

Each controller assembles a deterministic list of handlers:

```ts
const pipeline = [
  validateInput,
  jsonToDto,
  repoWrite,
  dtoToResponse
];
```

Handlers execute **in order**, passing state via `HandlerContext`.

Each handler has signature:

```ts
async function handler(ctx: HandlerContext, req: Request, res: Response)
```

### Handler responsibilities:
- read from `ctx`
- compute something
- write into `ctx`
- never return a value  
- never send response directly  

### Final response
The controller sends `{ meta, data }` **after** the last handler finishes.

---

## 5. Per-Action Pipelines

### 5.1 Create Pipeline
```
validateInput.handler.ts
jsonToDto.handler.ts
repoWrite.handler.ts
dtoToResponse.handler.ts
```

### 5.2 Update Pipeline
```
validateId.handler.ts
validatePatch.handler.ts
repoReadExisting.handler.ts
applyPatch.handler.ts
repoWrite.handler.ts
dtoToResponse.handler.ts
```

### 5.3 Read Pipeline
```
validateId.handler.ts
repoRead.handler.ts
dtoToResponse.handler.ts
```

### 5.4 Delete Pipeline
```
validateId.handler.ts
repoDelete.handler.ts
dtoToResponse.handler.ts
```

### 5.5 List Pipeline
```
validateQueryParams.handler.ts
repoList.handler.ts
dtoToResponse.handler.ts
```

### 5.6 Query Pipeline (optional)
```
validateQueryPayload.handler.ts
repoQuery.handler.ts
dtoToResponse.handler.ts
```

---

## 6. Input Validation Rules

### 6.1 ID Validation
Every ID must:
- be a UUID v4  
- match the DTO contract  
- appear exactly where expected in routing (`:id`)

### 6.2 DTO Validation
DTO instantiation always uses:

```ts
XxxDto.fromJson(body.doc, { validate: true })
```

No handler bypasses DTO validation.  
No “partial DTOs” or ad‑hoc validation objects.

---

## 7. Repository Interaction

Handlers interact with repositories **only through shared RepoBase** helpers:

- `repoRead`  
- `repoWrite`  
- `repoList`  
- `repoDelete`  
- `repoQuery`  

Repositories return **DTO instances** only.  
Never raw Mongo documents.

### Deterministic Behavior:
- Writes return DTO(s)  
- Reads return DTO or null  
- List returns `{ items, cursor }`  
- Delete returns success state  
- Query returns array of DTOs  

---

## 8. Response Shape (Mandatory)

All responses must use:

```json
{
  "meta": { /* requestId, cursor, counts, etc. */ },
  "data": [ /* DTOs */ ]
}
```

Even read/delete return an array.  
This ensures consistent downstream behavior and simplifies testing.

---

## 9. Error Handling

Errors are surfaced through centralized shared middleware and must follow RFC7807:

```json
{
  "type": "about:blank",
  "title": "Validation Error",
  "detail": "...",
  "status": 400,
  "requestId": "<uuid>"
}
```

Handlers should **throw**, never manually format responses.

---

## 10. Smoke Test Implications

### Pipeline correctness is required for:
- 003 duplicate-create  
- 004 read by id  
- 006 patch/update  
- 009 list sorting  
- 011 cursor last page  
- 014 create-id-dup-retry  
- 018 multi-create  
- 021 DTO shape round-trip  
- 022 noqa: idFieldName removal

If a handler is skipped or out of order, the test suite will catch it immediately.

---

## 11. Summary
Controllers = coordination.  
Handlers = execution.  
Pipelines = deterministic flow.

This rail ensures:
- consistent processing  
- repeatable behavior  
- correct audit trails  
- easy debugging  
- perfect clone reproducibility  

`t_entity_crud` sets the standard for all NV service pipelines.

