# LDD‑01 — NV Backend Overview (Broad, System‑Wide, Detailed)

## 1. Purpose of This Document
This chapter sets the philosophical, architectural, and operational context for the entire NowVibin backend. It explains **why** the shared CRUD rails exist, **how** they arose from multiple hard‑earned iterations, and **what role** they play in the ecosystem of NV services.  

It is not merely an overview of CRUD services; it is the *orientation map* for the entire platform:  
- the **environment‑backed configuration model**,  
- the **DTO‑first contract strategy**,  
- the **bag‑only wire semantics**,  
- the **pipeline architecture**,  
- the **index‑first persistence rules**,  
- and the **fail‑fast operational discipline** that keeps NV consistent across dozens of microservices.

Future chapters drill into each subsystem, but this one gives you the conceptual lay of the land.

---

## 2. Philosophy: Why NV Looks the Way It Does

### 2.1 The Early Pain That Motivated the Rails
The NV backend has been re‑designed several times. Earlier versions suffered from:
- implicit behavior,
- configuration drift,
- schema sprawl,
- JSON‑in‑JSON wrappers,
- non‑deterministic pipelines,
- dynamically‑constructed DTOs,
- and route definitions that weren’t stable across services.

The *CRUD rails* were born to cure these diseases permanently.

### 2.2 The Core Principles (The “Unbreakables”)
All NV services must strictly adhere to:
1. **DTO‑First Contracts**  
   Every data structure has a canonical DTO class. No “document” wrappers.  
2. **Wire Purity**  
   Wire = DTO JSON. Nothing else. No doc nesting, no ghosts.  
3. **Bag‑Only Transport**  
   Every returned dataset is a DtoBag or DtoBagView. No bare arrays.  
4. **Fail‑Fast**  
   If a service boots with missing env variables, missing indexes, or config mismatches, it exits immediately.  
5. **Deterministic Pipelines**  
   Each CRUD operation is composed of handlers running in a fixed, predictable order.  
6. **No Reflection, No Magic Imports**  
   Registries declare DTO constructors explicitly.  
7. **Environment Comes From env‑service, Not from .env**  
   All non‑secret config is stored and versioned in the database.  
8. **One Microservice = One Responsibility**  
   CRUD services behave like industrial modules. No leakage of domain knowledge across boundaries.

These principles allow NV to scale the number of services while maintaining stability and reproducibility.

---

## 3. NV Backend: The Big Picture

### 3.1 Three Generations of Design
- **v1**: monolithic tendencies, mixed config sources, unstructured handlers  
- **v2**: proto‑pipelines, DTO definition improvements, but still inconsistent across services  
- **v3 (current)**:  
  - DTO‑only persistence  
  - environment‑backed config  
  - shared CRUD rails  
  - bag‑first wire envelopes  
  - canonical registries  
  - deterministic boot and index‑creation flows  

### 3.2 How CRUD Services Fit Into the Ecosystem
CRUD services are the **building blocks** of NV.  
All domain services (acts, venues, events, env‑service, etc.) rely on them.

They deliver:
- a uniform create/update/read/delete/list surface,
- identical behavior across services,
- predictable indexing,
- auditable flows,
- predictable error semantics,
- easy client‑side consumption.

### 3.3 The Role of env‑service
env‑service stores configuration for every service in a database:
- which database URI to use,
- which database name,
- which collection,
- service base URLs,
- port/host bindings,
- logging level,
- and feature flags.

Every service boots using envBootstrap and receives a **DtoBag<EnvServiceDto>**.

This ensures:
- no drift between services,
- environment portability,
- centralized configuration management.

The CRUD rails depend on this to produce stable deployments.

---

## 4. High‑Level Architectural Map

### Indented Diagram
Architecture:
  API client →
    gateway →
      {slug}/v1 routes →
        controllers →
          pipelines →
            handlers →
              DTOs ↔ DbWriter ↔ MongoDB
              EnvServiceDto ↔ svcenvClient ↔ env‑service

### ASCII Diagram
API client
   ↓
gateway
   ↓
/api/<slug>/v1/<dtoType>/<op>
   ↓
ControllerBase
   ↓
Pipeline (ordered handlers)
   ↓
Hydrated DTOs
   ↓
Bag / BagView
   ↓
DbWriter → Mongo  
   ↓
response (problem+json or success)

---

## 5. The Conceptual Stack of a CRUD Service

A CRUD service consists of:

### 5.1 **Entrypoint**
- loads config via envBootstrap  
- extracts the primary EnvServiceDto  
- constructs and boots the app  
- mounts the routes  
- listens on host/port  

Detailed boot flows appear in LDD‑02.

### 5.2 **AppBase**
- initializes logger  
- holds envDto  
- runs onBoot lifecycle (index creation)  
- mounts all versioned routers  

See LDD‑04.

### 5.3 **DTO Registry**
- explicit mapping of dtoType → DTO constructor  
- hydrator injection  
- collection name resolution  
- indexHints consumption  

See LDD‑05.

### 5.4 **Controllers**
- orchestration only  
- builds HandlerContext  
- seeds hydrators  
- selects pipeline  
- handles finalize()  

See LDD‑06.

### 5.5 **Handler Pipelines**
Each CRUD op is defined as a **sequence of handlers**:
- BagPopulate (hydrate inbound bag)
- ExistingLoad (for update/delete/read)
- Validation
- Transformation (patch, etc.)
- Persistence (DbWriter)
- Result construction

CRUD flows are detailed in LDD‑08.

### 5.6 **Wire Semantics**
Uniform across all services:
- inbound JSON → dto → bag  
- outbound bag → JSON items[]  

Wire details in LDD‑07.

---

## 6. Why CRUD Rails Must Be Deterministic

### 6.1 Reliability of Indexing
Indexes must always match DTO.indexHints:
- deterministic  
- boot‑verified  
- immutable unless versioned  

If indexing is nondeterministic, pagination, sorting, and uniqueness break across services.

### 6.2 Predictable Error Path
NV guarantees predictable:
- 400 for client errors  
- 409 for duplicate keys  
- 500 for server errors  

No handler is allowed to produce ad hoc error formats.

### 6.3 Replayable Pipelines
CRUD pipelines must allow:
- debugging,
- testing,
- logging,
- auditing,
- pausing and future WAL replay.

The deterministic order enables these.

---

## 7. How CRUD Rails Enable Scaling to 20+ Services

### 7.1 Adding a New Service Should Be “Clone → Rename → Done”
Thanks to:
- shared AppBase behavior,
- shared registries,
- shared controllers,
- shared handlers,
- shared DbWriter,
- shared index builders.

The t_entity_crud service is the seed for any new service.

### 7.2 Shared Invariants Across All Services
Every CRUD service obeys:
- same boot sequence  
- same handlers  
- same error semantics  
- same DTO rules  
- same bag semantics  
- same indexing rules  

This eliminates drift.

### 7.3 Monitoring, Logging, Auditing, and Health
Shared rails makes:
- health endpoints identical  
- logging identical  
- audit behavior consistent  
- S2S introspection reliable  

---

## 8. Future Evolution Paths (High‑Level)

### 8.1 Migration from Hardcoded SvcClient Mappings to svcconfig
Eventually, base URLs for services will be resolved through svcconfig:
- no hardcoded map,
- dynamic discovery,
- version‑aware routing,
- hot reload of service endpoints.

### 8.2 S2S JWT Security
Once KMS is integrated:
- internal JWTs will authenticate S2S calls,
- SvcClient will issue tokens,
- gateway will remain the only public entrypoint.

### 8.3 WAL‑First Persistence
DbWriter will feed audit logs into:
- local WAL,
- the shared audit service.

This adds transactional visibility across services.

---

## 9. Summary
LDD‑01 sets the foundation for the entire CRUD rail system. It answers:
- what NV is trying to achieve,
- why CRUD rails exist,
- how services fit together,
- how the env‑service config model works,
- what the deterministic pipeline architecture enables,
- and why this system is built to scale without rewriting.

The following chapters will detail each subsystem:
- boot (LDD‑02)
- envBootstrap / SvcClient (LDD‑03)
- AppBase / runtime (LDD‑04)
- registries and indexes (LDD‑05)
- controllers and pipelines (LDD‑06)
- wire semantics and bags (LDD‑07)
- end‑to‑end flow diagrams (LDD‑08)

This concludes the high‑level orientation for the NV backend.

