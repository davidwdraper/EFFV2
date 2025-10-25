// docs/architecture/adr/adr0042-handler-context-bus.md
adr0042-handler-context-bus

# ADR-0042 — HandlerContext Bus (KISS Pattern)

## Context

NowVibin’s handler chain relies on a shared request-scoped data carrier that allows handlers to pass values forward.  
Early versions explored generic type-based contexts, immutable payload objects, and typed generics per route.  
Those designs, while safe, added friction and verbosity that conflict with NowVibin’s **KISS** principle and our goal of easily cloned microservices.

We need a **simple**, **obvious**, and **uniform** bus that can:
- be built once by `ControllerBase`,
- carry arbitrary data between handlers,
- require zero boilerplate in derived controllers,
- and prevent unnecessary coupling to types or route shapes.

---

## Decision

Adopt a minimal **key/value bus** model called **`HandlerContext`**, managed exclusively by `ControllerBase`.

### Key Points

1. **Single Source of Truth**
   - Only `ControllerBase` constructs and seeds the `HandlerContext`.  
   - Derived controllers and handlers never instantiate it manually.

2. **Minimal Interface**
   ```ts
   export class HandlerContext {
     set<T>(key: string, value: T): void;
     get<T>(key: string): T | undefined;
     snapshot(): Record<string, unknown>;
   }
   ```
   - Backed by a private `Map<string, unknown>`.
   - `get()`/`set()` are the only mutators.
   - `snapshot()` returns a shallow copy for logging or debugging.

3. **Construction and Seeding**
   `ControllerBase.handle()` seeds the bus once per request:

   ```ts
   const ctx = new HandlerContext();
   ctx.set("requestId", req.header("x-request-id") ?? "");
   ctx.set("headers", req.headers);
   ctx.set("params", req.params);
   ctx.set("query", req.query);
   ctx.set("body", req.body);
   ctx.set("app", appRef?);
   ```

4. **Handler Behavior**
   - Each handler receives the same `HandlerContext` instance.  
   - Handlers may `get()` any prior value and `set()` new data for downstream handlers.  
   - Controllers never inspect the context contents.

5. **Lifecycle**
   - Created at the start of `ControllerBase.handle()`.  
   - Destroyed when the request finishes.  
   - Not shared across requests.

---

## Consequences

### Benefits
- **Zero ceremony.** Simple `get()`/`set()` replaces complex generic payload typing.
- **No boilerplate in controllers.** Context creation is centralized in `ControllerBase`.
- **Maximum handler cohesion.** Handlers communicate only through the bus.
- **Easy testability.** Tests can new-up a `HandlerContext`, seed fields, and run handlers directly.
- **Predictable lifecycle.** One context per request; no leaks or global state.

### Trade-offs
- No compile-time type guarantees on context keys.  
  (Mitigated by naming conventions and disciplined usage.)
- Potential key collisions if conventions aren’t followed.  
  (Prefix route-specific keys where needed, e.g., `"dto.create"`.)

---

## Naming and Usage Conventions

| Category | Key Example | Purpose |
|-----------|--------------|----------|
| Request Metadata | `"requestId"`, `"headers"`, `"params"`, `"query"` | Seeded by controller |
| DTOs / Domain | `"dto"`, `"validatedDto"`, `"userRecord"` | Produced by handlers |
| Infra / Ops | `"walKey"`, `"dbConn"`, `"auditRecord"` | Temporary runtime values |
| App Reference | `"app"` | Optional app kernel reference when app isn’t visible |

Handlers should **read** what they need and **set** only what could help downstream logic.

---

## Alternatives Considered

1. **Generic Typed Contexts**
   - Too verbose and fragile across dozens of clones.

2. **Immutable Payload Objects**
   - Nice in theory; over-engineered for handler-to-handler handoffs.

3. **Global Singleton or DI Container**
   - Violates request isolation and introduces hidden coupling.

The chosen design maximizes clarity and minimizes friction.

---

## Implementation Notes

- Implemented in `@nv/shared/src/http/HandlerContext.ts`.  
- Integrated by `ControllerBase.handle()` (no exposure elsewhere).  
- Future enhancements (if needed):
  - Optional interface for `IHandlerContext` for mocking in tests.
  - Optional `delete(key)` or `has(key)` if useful.
  - Implement `Iterable<[key, value]>` for debug logging.

---

## References

- SOP (Reduced, Clean)
- ADR-0041 — Controller & Handler Architecture
- ADR-0040 — DTO-Only Persistence via Managers
