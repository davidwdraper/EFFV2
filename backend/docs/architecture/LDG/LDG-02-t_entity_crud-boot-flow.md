# LDG-02 — t_entity_crud Boot & App Initialization Flow

## 1. Purpose
This document details the full boot sequence for the `t_entity_crud` service.  
It defines **how the service starts**, **which shared rails it invokes**, and **how it becomes ready** to accept S2S requests.  
Every cloned service inherits this exact sequence.

---

## 2. High-Level Boot Flow
The boot process is deterministic and identical across all NV services:

1. **Load environment configuration** via envBootstrap → `SvcEnvClient.getConfig()`
2. **Initialize logger with requestId support**
3. **Connect to MongoDB**
4. **Build indexes for all DTO collections**
5. **Mount health route (`/api/<slug>/health`)**
6. **Mount S2S verification middleware**
7. **Load routes and controller pipelines**
8. **Start HTTP listener**

No shortcuts, no creative rearranging. Order matters.

---

## 3. Detailed Sequence

### 3.1. `envBootstrap()`
Loads environment configuration via the env-service.  
This populates:

- Mongo URI / DB
- Collection names for all DTOs
- S2S security settings
- Logging and misc service-level vars

If any required variable is missing → the service terminates immediately.  
Dev == Prod. No fallbacks.

---

### 3.2. Logger Initialization
Pino-based logger with:
- requestId binding
- service slug tagging  
- JSON output  
- health route minimal logging  

Every inbound request gets its own `x-request-id`.  
If missing, the gateway assigns one.

---

### 3.3. MongoDB Initialization
The service connects using the values pulled from env-service.

Connection rules:
- Must reach Mongo before continuing
- No silent retries
- No “connect later” nonsense  
- If connection fails → service exits

---

### 3.4. Index Building
Each DTO defines its index hints inside its Zod contract.

The boot process:
1. Reads DTO registry  
2. For each DTO:
   - Resolve its correct MongoDB collection via env-service vars  
   - Build all indexes deterministically  
3. Log completion

Index-building must be **idempotent** and **deterministic**, or smoke tests 001/002/003 break.

---

### 3.5. Health Route
Mounted **first**, always.

```
/api/<slug>/health
```

- Does NOT require S2S headers  
- Returns 200 OK, `{ status: "ok", slug, requestId }`  
- Must respond even when the service is half-broken

Smoke Test 001 depends on this.

---

### 3.6. S2S Authorization
Mounted immediately after health:

```
app.use(verifyS2S());
```

All protected routes require:
- authorization: Bearer <jwt>
- x-request-id
- x-service-name
- x-api-version

If any check fails → 401 Unauthorized (RFC7807).

---

### 3.7. Route & Controller Initialization
Routes follow:

```
/api/<slug>/v1/<dtoType>/<action>
```

Controllers use the predictable NV pipeline:
- Validate
- Instantiate DTO from JSON
- Repo read/write
- Map DTO(s) to response shape
- Return `{ meta, data }`

`HandlerContext` carries shared state across pipeline stages.

---

### 3.8. Start HTTP Listener
Final step:

```
app.listen(PORT, HOST)
```

Service logs “ready” with:
- slug
- port
- Mongo DB
- collection naming summary

---

## 4. Failure Modes

### Hard Fail (service exit)
- Missing env vars
- Mongo unreachable
- Index build failure
- Invalid env-service response
- Route mount errors

### Soft Fail (request-level)
- Unauthorized callers
- Invalid payloads
- DTO validation errors
- Repo mismatches
- Duplicate create (handled deterministically)

---

## 5. Smoke Test Implications
Boot flow supports:

- **001 health** — health route before all else  
- **002 s2s unauthorized** — verifyS2S placed before routes  
- **003 duplicate create** — index + deterministic `_id` behavior  
- All CRUD tests depend on correct initialization of:
  - envBootstrap  
  - Mongo connection  
  - Index building  
  - Route mounting  

---

## 6. Summary
`t_entity_crud` boot flow is rigid for a reason:  
predictability, testability, and cloning reliability.

Every cloned service begins life here, with these rails, in this order.

