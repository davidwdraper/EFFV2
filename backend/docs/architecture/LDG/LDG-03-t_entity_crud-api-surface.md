# LDG-03 — t_entity_crud API Surface & Route Architecture

## 1. Purpose
This document defines the complete API surface for the `t_entity_crud` service.  
It describes the structure of all routes, their DTO-type-driven segmentation, and the controller + handler pipeline each request travels through.  
This is the canonical reference for designing or cloning entity CRUD APIs in NV.

---

## 2. Route Pattern (Mandatory)
All routes follow the strict NV pattern:

```
/api/<slug>/v1/<dtoType>/<action>
```

Where:
- **slug** = the service identifier (“xxx”, “env-service”, etc.)
- **v1** = major API version
- **dtoType** = the exact DTO type key from the DTO registry  
- **action** = the operation (`create`, `update`, `read`, `delete`, `list`, `query`)

No variations, no shortcuts, no alternate forms.  
This pattern allows:
- dynamic routing
- correct DTO selection at runtime
- deterministic DB collection resolution

---

## 3. Available Endpoints (CRUD Standard)

### 3.1. `PUT <dtoType>/create`
Creates one or more DTO instances.  
Payload shape:

```json
{
  "items": [
    { "type": "<dtoType>", "doc": { /* DTO fields */ } }
  ]
}
```

Rules:
- Client may supply `_id` (UUID v4).  
- If absent, service generates it.
- Duplicate detection uses **duplicate-by-content**, not `_id` collision.
- Response wraps all created items.

---

### 3.2. `PATCH <dtoType>/update`
Updates a DTO by ID.

Payload:

```json
{
  "id": "<uuid>",
  "patch": { /* partial fields */ }
}
```

Rules:
- DTOContract ensures patch fields are valid.
- Partial updates only.
- `_id` cannot be patched.

---

### 3.3. `GET <dtoType>/read/:id`
Reads a single DTO by ID.

- Returns `{ meta, data }`.
- 404 if not found.
- Deterministic read path used for all smoke tests.

---

### 3.4. `DELETE <dtoType>/delete/:id`
Deletes a DTO by ID.

- Idempotent.  
- Returns 200 even if already deleted.  
- Ensures consistent behavior across clones.

---

### 3.5. `GET <dtoType>/list`
Lists paginated results.

Query params:
- `cursor`
- `limit`
- `sort` (optional)

Response rules:
- Uses deterministic cursor pagination.
- Smoke Test 11 ensures proper last-page handling.
- No legacy skip/limit is allowed.

---

### 3.6. `POST <dtoType>/query` (Optional Feature)
Advanced filtering endpoint.

Payload:
```json
{
  "filter": { /* Mongo-like filter */ },
  "limit": 100,
  "sort": { "field": 1 }
}
```

Not required by smoke tests but standardized for clone services.

---

## 4. Controller Architecture

### 4.1. Per-route Controllers
Each `<action>` has its own controller:

```
controllers/
  <dtoType>.create.controller.ts
  <dtoType>.update.controller.ts
  <dtoType>.read.controller.ts
  <dtoType>.delete.controller.ts
  <dtoType>.list.controller.ts
  <dtoType>.query.controller.ts
```

Controllers:
- attach a `HandlerContext`
- validate input
- forward to handler pipelines

Controllers are **thin** — they coordinate, not execute.

---

## 5. Handler Pipeline Structure
Each action uses a deterministic pipeline:

### Example for create:
1. `validateInput.handler.ts`
2. `jsonToDto.handler.ts`
3. `repoWrite.handler.ts`
4. `dtoToResponse.handler.ts`

### Example for read:
1. `validateId.handler.ts`
2. `repoRead.handler.ts`
3. `dtoToResponse.handler.ts`

### Example for list:
1. `validateQueryParams.handler.ts`
2. `repoList.handler.ts`
3. `dtoToResponse.handler.ts`

Pipelines enforce:
- isolation of concerns  
- deterministic test execution  
- clean audit trails (future integration)

---

## 6. DTO Selection via DtoRegistry
The `dtoType` path segment selects the correct DTO class:

```
const DtoCtor = DtoRegistry.get(dtoType);
```

If not found:
- immediate 400  
- smoke tests expect a deterministic RFC7807 error

This guarantees that multi-DTO services behave like a collection of mini-services under one slug.

---

## 7. Error Behavior (RFC7807 Standard)
All endpoints return standardized error shapes:

```json
{
  "type": "about:blank",
  "title": "<error>",
  "status": <code>,
  "detail": "<message>",
  "requestId": "<uuid>"
}
```

Used for:
- validation errors  
- not found  
- unauthorized  
- duplicate detection  
- malformed request  

No nonstandard error responses are allowed.

---

## 8. Smoke Test Implications

### Ensures:
- Routes are discovered correctly  
- DTO selection is accurate  
- CRUD flows follow NV rails exactly  
- Duplicate creates behave deterministically  
- List endpoints handle pagination correctly  
- Read/Delete use `_id` instead of external keys  
- All responses wrap results in `{ meta, data }`

### Breaks if:
- Route shape changes  
- Controllers do too much  
- Pipelines skip required stages  
- DTO selection drifts  
- Collection naming mismatches occur  

---

## 9. Summary
This LDG defines the **entire external surface** of a CRUD service:

- The route shape  
- The actions  
- The controller-to-handler pipeline  
- The DTO resolution flow  
- The error behavior  
- The pagination rules  
- The smoke-test-critical invariants  

It is the backbone of every NV CRUD service and the single source of truth when cloning services or validating test failures.

