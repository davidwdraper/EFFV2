# adr0097-controller-bag-hydration-and-type-guarding

## Context

In NV, every controller pipeline exists solely to service an inbound HTTP
request via a mounted route.

Controllers are therefore:

- Route-bound
- Aware of the endpoint’s input contract
- Responsible for seeding the HandlerContext (`ctx`) for downstream execution

Historically, controller pipelines performed initial input work using one or more
handlers at the beginning of every pipeline, such as:

- Wire → DTO bag hydration (`toBag`)
- Allowed DTO type guards
- Cardinality enforcement (singleton vs multi)

This resulted in:

- Repetitive pipeline definitions
- Boilerplate handler duplication
- Unnecessary pipeline execution overhead
- Reduced control over nuanced DTO factory / registry behavior
- Violations of the “no JSON in handlers” principle

At scale, executing identical “first-step” handlers in every pipeline is both
noisy and unnecessary.

## Decision

Move **wire → DTO bag hydration** and **DTO type guarding** out of pipelines and
into the controller execution prelude.

Controllers will now:

1. Seed the HandlerContext with request-scoped primitives (requestId, headers, etc.)
2. If a request body is present:
   - Hydrate the body into a canonical `DtoBag` using shared DTO factories / registries
   - Verify that all hydrated DTOs are of types allowed by this route/controller
   - Place the validated bag on `ctx["bag"]`
3. If no body is present:
   - Do nothing (no bag is seeded)

Controllers perform **transport normalization and input contract enforcement only**.
They do **not** perform business logic, domain mutation, or policy decisions beyond
what the route contract requires.

Pipelines will no longer include initial hydration or type-guard handlers.

## Invariants

- Controllers deliver **input DTOs**, not raw JSON.
- Raw request JSON must never be exposed to handlers.
- All inbound payload access occurs via `ctx["bag"]`.
- DTO type validation is performed **after hydration**, using the DTO’s canonical
  self-reported type (not the wire’s claimed type).
- If a request contains an invalid DTO type for the route, the request fails
  before pipeline execution begins.
- Pipelines start from a guaranteed invariant:
  - `ctx["bag"]` exists (or does not exist) and is already contract-valid.

## Rationale

- Controllers are tightly coupled to their routes and therefore know the correct
  input contract.
- DTO hydration and type verification are transport-level concerns, not business logic.
- Performing these steps centrally eliminates repetitive first-step handlers.
- Verifying type after hydration preserves the “no JSON in code” rule by construction.
- Inefficiency from hydrating an invalid DTO is acceptable, as it occurs only on
  erroneous client input and preserves a single canonical hydration path.

## Consequences

### Positive

- Eliminates duplicated hydration and guard handlers from pipelines
- Enforces “no JSON in handlers” by construction
- Centralizes DTO factory and registry behavior
- Improves performance by removing redundant pipeline steps
- Simplifies pipelines to intent-focused orchestration only
- Makes handler and handler-test refactoring more mechanical and boilerplatable

### Tradeoffs

- Controllers take on responsibility for input normalization and contract validation
- DTO validation errors now occur before pipeline execution
- Requires careful refactoring of controller base / runtime code

These tradeoffs are intentional and aligned with NV’s architectural goals.

## Implementation Notes

- Hydration and type guarding logic will live in shared controller base / runtime
  code, not in individual controllers.
- Controllers may optionally specify:
  - Allowed DTO types for the route
  - Cardinality expectations (singleton vs multi)
- Existing hydration and type-guard handlers will be removed or deprecated once
  controller refactoring is complete.
- Pipelines assume validated input and focus exclusively on orchestration and
  business steps.

## Next Steps

**Next session plan:**

1. Refactor controller base/runtime to:
   - Hydrate request bodies into DTO bags
   - Enforce allowed DTO types
2. Remove initial hydration and guard handlers from pipelines
3. Continue handler and handler-test refactoring under the new invariant:
   pipelines always start with validated `ctx["bag"]` (or no bag)

## Status

Accepted. Locked.
