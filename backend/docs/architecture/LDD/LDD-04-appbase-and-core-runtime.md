# LDD-04 — AppBase and Core Runtime (Full-System Deep Dive)

## 1. Purpose
This chapter details **AppBase**, the heart of every CRUD service.  
AppBase governs:

- the boot lifecycle,
- logger initialization,
- envDto storage,
- hydrator wiring,
- registry and index preparation,
- route mounting discipline,
- the readiness contract,
- and core runtime invariants.

AppBase is deliberately small in surface area but *strict* in behavior, forming the predictable runtime spine for all NV services.

---

## 2. Why AppBase Exists

### 2.1 The Problem Before AppBase  
Earlier NV versions embedded boot logic inside each service’s `index.ts`, creating:
- drift in initialization order,
- inconsistent index creation,
- inconsistent route mounting,
- varying logger behavior,
- improper early access to configuration,
- and subtle circular dependencies.

### 2.2 The Solution  
AppBase enforces a **canonical boot lifecycle**:

1. Construct AppBase (or subclass)  
2. `onBoot()` (registry checks + index creation)  
3. Mount routes  
4. Listen  

And guarantees:
- logger exists before any route mounts,
- envDto is bound and immutable during runtime,
- boot cannot be skipped,
- indexes are present before accepting traffic,
- health endpoint behaves uniformly.

---

## 3. AppBase Responsibilities (Indented)

AppBase:
  stores envDto
  stores envReloader
  initialize logger based on envDto
  define boot()
    call onBoot()
      run registry diagnostics
      run registry.ensureIndexes()
    mount all versioned routes
  expose getEnvDto()
  expose getLogger()
  expose getRegistry()
  wire health endpoint
  finalize app.listen()

---

## 4. AppBase Responsibilities (ASCII)

AppBase ctor
    ↓
logger.init()
    ↓
store envDto + envReloader
    ↓
boot():
    ↓
onBoot()
    ↓
registry.ensureIndexes()
    ↓
mountRoutes()
    ↓
ready to listen

---

## 5. Construction Phase (Deep Detail)

When a CRUD service uses `createApp()`, it returns a subclass of AppBase.

### 5.1 Required Inputs
AppBase requires:
- **slug**  
- **version**  
- **envDto**  
- **envReloader**  
- **logger factory**

These become runtime constants.

### 5.2 Logger Initialization
Logger is initialized using envDto.vars:
- LOG_LEVEL  
- LOG_PRETTY (optional for dev)  
- SERVICE_NAME (often same as slug)

Logger invariants:
- must exist before onBoot(),
- must prefix requestId in middleware,
- must log index creation events,
- must log boot success/failure.

---

## 6. The Boot Lifecycle

### 6.1 Sequence  
Boot:
  call onBoot()
  registry.ensureIndexes()
  mountRoutes()

### 6.2 onBoot()
onBoot is implemented per service:
- env-service uses local DB bootstrap
- CRUD services check registry entries
- Some services may preload cache or run migrations

onBoot invariants:
- must be synchronous or awaited,
- must not mount routes,
- must not open sockets,
- must not modify envDto.

### 6.3 Index Creation
`registry.ensureIndexes()`:
- gathers DTO constructors,
- inspects indexHints,
- builds and verifies indexes,
- logs every action.

If indexing fails:
- boot aborts,
- service exits with non-zero code.

### 6.4 Route Mounting
Routes are mounted **after** index creation:
- ensures no request sees unindexed collections,
- prevents race conditions around unique constraints.

Route mount strategy:
- mount `/api/<slug>/v<major>` base,
- each dtoType gets full CRUD path.

---

## 7. Health Route (Global Invariant)

All services must expose:
```
/api/<slug>/health
```

Health returns:
- `{ ok: true, service: slug, version, requestId }`

Health must:
- not touch the database,
- not call env-service,
- not reload anything,
- be available before other routes,
- never throw.

AppBase ensures:
- health mounts first,
- health always has logger and requestId middleware active.

---

## 8. envDto & envReloader

### 8.1 envDto
Immutable during runtime.  
Defines:
- Mongo URI,
- DB name,
- base collection,
- per-DTO collection overrides,
- runtime host/port,
- service metadata.

### 8.2 envReloader
Function for manual or scheduled reloads:
- returns new envBag,
- hydrates new DTO,
- may update logger (future),
- may support hot reconfig.

---

## 9. Registry Binding

AppBase binds:
- registry instance,
- DTO constructors,
- index builder hooks.

Registries must:
- register DTO constructors before boot,
- provide collection names,
- provide index hints,
- provide hydrators.

AppBase does not modify registry—it just wires it.

---

## 10. Error Modes & Operations

### 10.1 Boot Errors
If onBoot or index creation fails:
- AppBase logs error,
- service exits,
- smoke tests will detect failure.

### 10.2 Bad envDto
If envDto.vars is missing fields:
- app fails to start,
- descriptive error logs printed.

### 10.3 Route Mount Failures
If a router throws during mount:
- service aborts boot,
- ensures no partial boot.

---

## 11. Future Evolution

### 11.1 Dynamic envReload
AppBase may support:
- timer-based config reload,
- logger level hot changes,
- dynamic routing table refresh (with svcconfig).

### 11.2 S2S Authorization Hooks
AppBase may incorporate:
- middleware for verifying S2S JWTs,
- requestAuthenticator wiring.

### 11.3 WAL Integration
AppBase may integrate:
- startup WAL replay,
- commit-log hooks for DbWriter.

---

## 12. Summary
AppBase is the deterministic backbone of all CRUD services.  
It ensures:
- stable boot,
- correct environment,
- initial index consistency,
- unified health behavior,
- predictable runtime behavior.

With AppBase fully defined, the next chapter (LDD-05) dives into the DTO Registry and Indexing System, the machinery that ensures all CRUD services persist DTOs consistently.

