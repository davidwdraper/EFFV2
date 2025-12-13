adr0075-controller-seeds-dto-ctor-for-db-handlers

# ADR-0075 — Controller-Seeded DTO Constructors for DB Read Handlers

## Context

The NV backend uses generic, shared DB read handlers (e.g., `DbReadOneByFilterHandler`) that hydrate database records into DTO instances.
These handlers cannot hardcode DTO constructors and must rely on the runtime context to determine **which DTO type to instantiate**.

During prompt-service debugging, a failure occurred where a DB read handler executed without a DTO constructor present on the `HandlerContext` bus,
resulting in a fail-fast error (`bag.query.dtoCtor missing or invalid`).

The root cause was a mismatch between:
- Controller execution with `requireRegistry: false`, and
- A pipeline containing DB handlers that require registry-backed DTO hydration.

This exposed an implicit rule that had not yet been formalized.

## Decision

1. **Controllers are responsible for resolving DTO constructors from the Registry**
   - If a controller executes a pipeline that includes any `db.*` read handler,
     it **must** run with `requireRegistry: true`.

2. **Controllers must seed the resolved DTO constructor into the HandlerContext**
   - The controller resolves the constructor using the Registry and seeds it on the context bus:
     - `ctx["bag.query.dtoCtor"] = <DtoCtor>`
   - This must occur *before* any DB read handler executes.

3. **DB read handlers remain generic and strict**
   - DB handlers will not attempt to infer, guess, or fallback to DTO constructors.
   - Absence of a valid `dtoCtor` remains a fail-fast error.

4. **Service registries must fully implement `ServiceRegistryBase`**
   - Even services that do not apply user-type logic (e.g., prompt service)
     must implement required abstract methods (such as `applyUserType`) explicitly,
     using a no-op pass-through where appropriate.

## Consequences

### Positive
- Enforces explicit, deterministic DTO hydration.
- Keeps DB handlers reusable, simple, and safe.
- Makes controller responsibilities clear and auditable.
- Prevents silent or incorrect DTO instantiation.
- Aligns with DTO-first and registry-authoritative architecture.

### Negative
- Controllers must perform one additional explicit step when orchestrating DB reads.
- Slightly more boilerplate in controllers, in exchange for correctness.

## Implementation Notes

- Controllers that execute DB-backed pipelines must:
  1. Enable registry preflight (`requireRegistry: true`).
  2. Resolve the DTO constructor via the service registry using `dtoType`.
  3. Seed `ctx["bag.query.dtoCtor"]` before pipeline execution.

- Pipelines do **not** resolve constructors themselves.
- Handlers do **not** mutate or override the seeded constructor.

## Alternatives Considered

1. **Have DB handlers resolve constructors themselves**
   - Rejected: violates separation of concerns and makes handlers registry-aware.

2. **Introduce implicit defaults or fallbacks**
   - Rejected: violates fail-fast, greenfield, and dev≈prod invariants.

3. **Allow pipelines to seed constructors**
   - Rejected: constructor resolution is orchestration responsibility, not handler logic.

## References

- ADR-0040 — DTO-Only Persistence
- ADR-0042 — HandlerContext Bus (KISS)
- ADR-0049 — DTO Registry & Canonical ID
- LDD-05 — DTO Registry & Indexing
- LDD-06 — Controller & Pipeline Architecture
