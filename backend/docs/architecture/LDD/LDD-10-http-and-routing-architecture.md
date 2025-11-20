# LDD-10 — HTTP & Routing Architecture (Health, Versioning, dtoType Semantics)

## 1. Purpose

This chapter defines the runtime HTTP surface of all NV CRUD services:
- Versioned base paths
- dtoType as a first-class routing key
- Health endpoint rules
- Controller mount order
- Safety rails (validate-first, no reflection, no barrels)
- Contracts for inbound/outbound wire envelopes

---

## 2. Health Endpoint Architecture

### 2.1 Invariants
- Health route must be mounted **before** any middleware.
- Health must:
  - echo requestId
  - return `{ ok:true }` shape
  - never touch persistence
  - never access registry
  - never call envReloader

### 2.2 Why strict health rules?
- Smoke tests depend on deterministic health.
- Load balancers require fast health responses.
- Health failures must indicate boot-time config issues only.

---

## 3. Versioned Base Path

Every service mounts routes under:
```
/api/<slug>/v<version>
```

### 3.1 Invariants
- No trailing slash.
- Must be computed from AppBase (slug + version).
- All CRUD endpoints are relative to this base.
- No cross-service aliasing.

---

## 4. dtoType in Routing

dtoType appears as a path element:
```
PUT    /:dtoType/create
GET    /:dtoType/read/:id
PATCH  /:dtoType/update/:id
DELETE /:dtoType/delete/:id
GET    /:dtoType/list
```

### 4.1 Why dtoType is mandatory
- Services may support multiple DTO types.
- Registry selection requires stable keys.
- DTO constructors map to registries by dtoType.
- Validation and collectionName depend on it.
- Prevents rogue endpoints operating on wrong data.

### 4.2 Error Modes
- Missing dtoType → 400 Bad Request (ControllerBase.makeDtoOpContext)
- Unknown dtoType → 400 UNKNOWN_DTO_TYPE
- dtoType must match a registry entry

---

## 5. RequestId Contract

Every inbound request must have a requestId:
- If provided: use client header
- If absent: generate random ID
- Must be included in all logs, all errors, and health

Invariants:
- requestId must travel through handlers unchanged.
- All Problem+JSON output must include requestId.

---

## 6. HTTP Verb Mapping

### 6.1 CREATE → PUT
- Idempotent by DTO identity.
- Allows clients to create records with predetermined IDs.
- Aligns with WAL-first semantics.

### 6.2 UPDATE → PATCH
- Partial update semantics.
- dto.patchFrom() enforces contract and field rules.

### 6.3 READ → GET
- Pure, always safe.

### 6.4 DELETE → DELETE
- Idempotent by design (delete nonexistent still ok).

---

## 7. Wire Envelope Normalization

Inbound JSON:
```
{
  "items": [
    { id, ...fields }
  ]
}
```

Outbound JSON:
```
{
  "items": [...],
  "meta": { ... }
}
```

### 7.1 No legacy “doc”
Old envelope:
```
{ items: [{ doc: {...} }] }
```
is forbidden.

---

## 8. Error Responses (Problem+JSON)

All errors must follow:
```
{
  "type": "about:blank",
  "title": "...",
  "detail": "...",
  "status": <code>,
  "code": "DUPLICATE_ID" | "NOT_FOUND" | ...,
  "issues": [...],
  "requestId": "..."
}
```

Controllers normalize:
- duplicate key errors
- validation errors
- missing dtoType
- missing id
- registry errors

---

## 9. Safety Rails

### 9.1 No barrels or dynamic routing
- Routes must be explicit one-liners.
- No directory scanning or auto-discovery.
- Prevents drift and ambiguous registrations.

### 9.2 Explicit controllers
- Each DTO type gets explicit controllers.
- Pipelines must exist before route is added.

### 9.3 Thin routers
- No inline logic.
- Only controller invocation.

---

## 10. Future Evolution

- svcconfig-based base URL discovery
- per-endpoint feature flags
- auth middleware (verifyS2S)
- multi-dtoType composite endpoints
- HATEOAS expansion for discovery
- streaming LIST endpoints

---

End of LDD-10.
