// docs/architecture/adr/adr0041-controller-and-handler-architecture.md
adr0041-controller-and-handler-architecture

# ADR-0041 — Controller and Handler Architecture

## Context

NowVibin services are expanding rapidly and must remain easy to reason about, clone, and test.  
Prior designs blurred orchestration and business logic inside controllers, creating maintenance drift and duplicated code.  

We need a strict, enforceable separation of concerns so every developer and service clone behaves identically.

---

## Decision

### 1. Controllers Orchestrate — They Never Contain Logic
- Controllers exist only to sequence **handlers**.
- Each controller method corresponds to a route and simply runs its chain of handlers.
- No validation, persistence, or branching logic appears in a controller.

### 2. Handlers Are Single-Purpose Execution Units
- Each handler file follows the naming pattern:
  ```
  <handlerName>.<route>.handler.ts
  ```
  Example: `validate.put.handler.ts`, `create.patch.handler.ts`, `bill.payme.handler.ts`.
- `<handlerName>` is a one-word description of its job.
- `<route>` matches the route keyword used in the router file.
- Each handler performs exactly **one business function** and has one reason to change.

### 3. Services Encapsulate Reusable Logic
- When a handler requires logic that might be reused by other handlers **within the same service**,  
  it must instantiate a **service class** for that purpose.
- These service classes live under:
  ```
  /src/services/
  ```
- Services handle persistence, integrations, or computational logic, not controllers.

### 4. Shared Logic Belongs in the Shared Project
- If a service-specific service becomes useful across multiple services,  
  it is promoted to the shared project under:
  ```
  backend/services/shared/src/services/
  ```
- Promotion requires adding or updating an ADR referencing the move and its intended reuse boundaries.

### 5. Base Classes Encourage Uniformity
- Any pattern replicated across classes (controllers, handlers, services)  
  should be extracted into a base class under `shared/src/base/`.
- Example: `HandlerBase`, `ControllerBase`, `ServiceBase`.
- Base classes ensure consistent logging, error reporting, and instrumentation across the ecosystem.

### 6. File Hierarchy Discipline

```
backend/services/<slug>/
└─ src/
   ├─ controllers/
   │   ├─ <route>.controller/
   │   │   ├─ <route>.controller.ts
   │   │   └─ handlers/
   │   │       ├─ <handlerName>.<route>.handler.ts
   │   │       └─ ...
   ├─ services/
   │   ├─ <serviceName>.service.ts
   │   └─ ...
   ├─ routes/
   │   ├─ <slug>.route.ts
   └─ ...
```

---

## Consequences

### Benefits
- Enforces **one reason to change** per file.
- Ensures controllers remain orchestration only.
- Makes service cloning and refactoring trivial.
- Encourages clear promotion paths from handler → service → shared.
- Enables predictable test structure (unit test = file name).

### Trade-offs
- Increases file count per feature (intentional; improves readability).
- Slightly more boilerplate for small endpoints.

---

## Implementation Notes
- Controllers will extend a `ControllerBase` (planned).
- Handlers will extend a `HandlerBase` (planned).
- Both bases provide:
  - structured logging with `x-request-id` propagation,
  - unified error handling (Problem+JSON),
  - performance metrics hooks.

---

## Future Discussion Points
1. Should multiple handlers in a chain share a mutable “context” object? (Proposed: yes, read-only outside their scope.)
2. Should HandlerBase enforce idempotency by design?
3. Should ControllerBase own request-level audit lifecycle (start/commit/flush)?
4. Consider decorator-based auto-binding of handlers in the future, only if it remains transparent and testable.

---

## References
- SOP (Reduced, Clean)
- ADR-0001 (Gateway Embedded SvcConfig)
- ADR-0015 (DTO-First Development)
- ADR-0040 (DTO-Only Persistence)
