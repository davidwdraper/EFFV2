adr0098-domain-named-pipelines-with-pl-suffix

## Context

NV currently defines controller pipelines using `index.ts` files inside pipeline folders (e.g. `pipelines/signup.handlerPipeline/index.ts`) that export a `getSteps(ctx, controller)` function returning a list of handler instances.

This approach was intentionally lightweight early on, but it has scaling problems:

- Pipeline identity is implicit (effectively the folder name), not explicit in code.
- There is no named, first-class pipeline artifact to reference in logs, discovery, or documentation.
- Domain-specific bus seeding often becomes “micro-handlers” whose only job is `ctx.set(...)`, creating noise and wasted effort.
- As endpoint complexity increases, developers will naturally circumvent rigid conventions by writing fewer, larger handlers, reducing test granularity and observability.

NV is still greenfield: no production consumers, no compatibility requirements, and no value in shims.

## Decision

Refactor pipeline definitions from folder `index.ts` step factories into **domain-named pipeline modules** using the `PL` suffix (Pipeline), starting with Auth Signup.

Example target naming:

- `UserSignupPL.ts` (domain named)
- (Optional) Keep a short folder, but the pipeline identity is the module/class name, not the folder.

We will treat this as brand-new code:

- No shims
- No compatibility layers
- Refactor → break → fix → test → repeat until green

### Pipeline form

A pipeline will be implemented as a **first-class pipeline object** (class or module) that:

1. Declares an explicit pipeline name/identity in code.
2. Builds and returns the ordered handler steps.
3. May execute **bus-only helper steps** between handlers to seed domain-specific ctx values.

### Bus-only helper steps

Pipelines may include helper functions (not handlers) that exist solely to seed the `HandlerContext` bus:

- Inputs: `ctx` + explicit parameters
- Output: `ctx.set(...)` only
- No I/O, no S2S calls, no DB, no crypto, no logging policy, no business rules
- If a step requires real logic, it must be a handler (and gets a sidecar test).

This adds flexibility without weakening the “handlers do the work” architecture.

## Invariants

- Pipeline identity must be explicit in code (not implied by folder structure).
- Pipelines remain orchestration artifacts; business logic remains in handlers.
- Helpers are bus-only (ctx seeding), never domain mutation or policy.
- Handler sidecar tests remain the canonical testing mechanism for logic steps.
- We accept breaking changes freely until the new structure is fully green.

## Consequences

### Positive

- Pipeline identity becomes explicit, searchable, and loggable.
- Controllers and test tooling can reference pipelines without relying on file path conventions.
- Reduces “busywork handlers” that only seed ctx keys.
- Enables clearer, more maintainable orchestration as endpoint complexity grows.
- Encourages keeping complex endpoints decomposed (more small handlers, fewer god-handlers).

### Tradeoffs

- Slightly more structure than a pure `index.ts` export.
- Requires discipline to prevent helpers from accreting real logic.
- Requires refactors across controllers/tests as pipelines are renamed and rehomed.

These tradeoffs are accepted because NV is greenfield and prioritizes long-term maintainability.

## Implementation Notes

- Adopt `PL` suffix universally for pipeline modules:
  - `UserSignupPL.ts`, `EnvServiceConfigLoadPL.ts`, etc.
- Keep names short and domain-oriented to avoid path/filename bloat.
- Prefer class-based pipelines if it improves discovery/metadata (name, controller factory, step list).
- Remove the old `index.ts` pipeline entry point entirely during refactor (no shims).

## Next Steps

1. Create `UserSignupPL.ts` for Auth Signup and migrate step composition from `index.ts`.
2. Update `AuthSignupController` to use the new pipeline module/class directly.
3. Update test-runner discovery and any pipeline-based tests to reference the new pipeline artifact.
4. Delete the old `index.ts` pipeline definition (no compatibility).
5. Repeat service-by-service until all pipelines follow the `PL` convention.

## Status

Accepted. Locked.
