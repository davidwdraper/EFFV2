# LDD-02 — Boot Sequence (Deep Dive)

## 1. Purpose
This chapter documents the full NV boot sequence for all CRUD services, from process start to HTTP readiness. It explains every subsystem involved, why each step exists, and what invariants are enforced. Minimal examples are included only when essential.

## 2. High‑Level Boot Philosophy
Boot must be:
- deterministic,
- fail‑fast,
- environment‑backed,
- index‑verified,
- fully instrumented.

No CRUD service may start unless:
- its environment exists in env‑service,
- its config DTO passes validation,
- Mongo indexes match DTO.indexHints,
- its routes are mounted under the correct base path,
- and its runtime logger is initialized via EnvServiceDto.

## 3. Boot Sequence — Indented Diagram
Boot:
  process start →
    load entrypoint (index.ts) →
      envBootstrap(slug, version) →
        SvcClient(callerSlug/version) →
        SvcEnvClient.getCurrentEnv() →
        SvcEnvClient.getConfig(env, slug, version) →
        produce DtoBag<EnvServiceDto> →
      extract primary EnvServiceDto →
      createApp({ slug, version, envDto }) →
        AppBase() ctor →
        setLoggerEnv(envDto) →
        onBoot() →
          registry.listRegistered() →
          registry.ensureIndexes() →
            ensureIndexesForDtos() →
              Mongo index creation/verification →
        mountRoutes() →
          /api/<slug>/v<version> →
            router (dtoType routes) →
      app.listen(host, port)

## 4. Boot Sequence — ASCII Diagram
process start
    ↓
index.ts
    ↓
envBootstrap(slug, version)
    ↓
SvcClient ──→ env‑service
    ↓
config bag (DtoBag<EnvServiceDto>)
    ↓
primary EnvServiceDto
    ↓
createApp()
    ↓
AppBase.boot()
    ↓
Registry.ensureIndexes()
    ↓
mountRoutes()
    ↓
app.listen()

## 5. Step‑By‑Step Breakdown

### 5.1 Process Start
Node loads `index.ts`. No logic is allowed before envBootstrap. No environment variables (except NV_ENV) influence behavior.

### 5.2 envBootstrap()
Responsibilities:
- Construct SvcClient.
- Construct SvcEnvClient.
- Resolve env via NV_ENV.
- Fetch EnvServiceDto bag for (env, slug, version).
- Validate host/port.
- Produce an envReloader for future hot reload of config.

Invariants:
- NV_ENV must be defined.
- env-service must return ≥1 DTO.
- NV_HTTP_HOST and NV_HTTP_PORT must be valid.
- A missing bag is a fatal boot error.

### 5.3 Extract Primary EnvServiceDto
The first DTO in the bag is considered authoritative. Bags are ordered on the wire and always represent a single logical record for this service.

If the bag is empty:
- fatal with BOOTSTRAP_ENV_BAG_EMPTY.

### 5.4 Create App
`createApp()` constructs a subclass of AppBase. Responsibilities:
- Set logger environment.
- Store envDto.
- Store envReloader.
- Prepare to run the boot lifecycle.

### 5.5 AppBase.boot()
Boot is a controlled two‑phase lifecycle:
1. `onBoot()` — subclass‑defined pre-route initialization.
2. `mountRoutes()` — after indexes are ensured.

Invariants:
- mountRoutes() must not run before ensureIndexes.
- AppBase.boot() must fully complete before app.listen().

### 5.6 onBoot() → Registry Diagnostics
Registry lists DTO types and their collections. This is non-fatal diagnostics. It helps confirm the registry map is correct pre-index creation.

### 5.7 Index Verification
Registry.ensureIndexes():
- collects all DTO constructors with indexHints,
- builds a request describing their collections + index sets,
- calls ensureIndexesForDtos(),
- verifies every index exists exactly as defined.

If indexes fail to build:
- boot aborts,
- process exits.

Why?
- Without deterministic indexes, CRUD semantics (especially unique constraints and pagination) become unstable.

### 5.8 mountRoutes()
Once indexes are guaranteed stable:
- mount versioned base path `/api/<slug>/v<version>`
- attach router with all DTO-type-based CRUD endpoints.

No controller logic runs during boot.

### 5.9 app.listen()
Only after:
- env loaded,
- config validated,
- indexes created,
- routes mounted,
- logger initialized,

the service opens the network port.

Instrumentation logs:
- service slug,
- version,
- host,
- port.

## 6. Failure Modes & Operator Guidance

### 6.1 Missing NV_ENV
Fatal. Service prints:
“SVCENV_CURRENT_ENV_MISSING”

Fix:
- export NV_ENV=dev (or stage/prod).

### 6.2 env-service Unreachable
Fatal. envBootstrap logs:
“BOOTSTRAP_CURRENT_ENV_FAILED”

Fix:
- ensure env-service running,
- ensure mock URL (for dev) is correct,
- ensure gateway/service ports are not colliding.

### 6.3 Config Bag Missing or Empty
Fatal. Means the env-service record for (env, slug, version) was not created.

Fix:
- create config via env-service clone operation.

### 6.4 Invalid NV_HTTP_HOST or NV_HTTP_PORT
Fatal. Values must be strings/integers.

### 6.5 Index Creation Failure
Fatal. Means:
- collection missing,
- index hints invalid,
- connectivity failure,
- miswired environment variables for database connection.

Fix:
- check EnvServiceDto vars for NV_MONGO_URI/NV_MONGO_DB,
- confirm DTO.indexHints accuracy.

## 7. Summary
Boot is deterministic, environment-backed, index-verified, and fail-fast. Everything must pass before a service accepts traffic. This guarantees predictable CRUD behavior across all NV microservices.

This concludes the full deep dive on the NV Boot Sequence.

