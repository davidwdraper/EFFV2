adr0093-shared-exports-dist-only-runtime

# ADR-0093 — Shared Exports & Dist-Only Runtime

## Context

NV’s backend has suffered from persistent configuration drift since the beginning of the project. Small changes to build or runtime behavior have frequently caused cascading failures across services, broken imports, and situations where edits appeared to “not take.”

The most damaging root cause uncovered in early 2026 was **split-brain module resolution**:

- Some imports resolved to **TypeScript source** (`shared/src/...`) via `tsx` + `tsconfig-paths`.
- Other imports resolved (or attempted to resolve) via **Node package exports** into **compiled JavaScript** (`shared/dist/...`).
- In certain cases, the same package resolved differently for different subpaths _inside the same running process_.

This was proven empirically using `require.resolve` probes under different runtimes:

- Under `node`:

  - `@nv/shared` resolved to `shared/dist/index.js`
  - Deep subpaths (e.g. `@nv/shared/http/problem`) failed or attempted to resolve to non-existent `dist` paths

- Under `tsx -r tsconfig-paths/register`:
  - `@nv/shared` resolved to `shared/src/index.ts`
  - Some deep imports resolved to `shared/src/...`
  - Other deep imports fell through to Node’s package resolver and attempted (and failed) to load from `dist`

This produced a _single runtime_ executing a mixture of:

- TS source files
- compiled JS files
- partially broken deep imports

As a result:

- Debugging was unreliable
- Refactors appeared ineffective
- Logging behavior (the original trigger for this investigation) could not be trusted

Separately, NV has hard constraints:

- **Dev == Prod** behavior (same runtime shape; only env/ports differ)
- Services must execute **JS from `dist/`**, not TS at runtime
- `@nv/shared` will grow to **hundreds of DTOs, sidecars, handlers, and utilities**
- Maintaining a brittle export manifest or giant barrel `index.ts` is unacceptable
- We cannot afford another repo-wide configuration tailspin

## Decision

1. **NV runtime is dist-only**

   - All services, in dev and prod, execute **compiled JS from `dist/`**
   - TypeScript is used for compilation only, never as a runtime convenience layer

2. **`@nv/shared` exposes a file-based API, not a manifest**

   - Deep imports are first-class:
     - `@nv/shared/http/problem`
     - `@nv/shared/http/handlers/HandlerBase`
     - `@nv/shared/dto/user/UserDto`
   - A central export manifest or barrel file is explicitly avoided

3. **`@nv/shared` uses Node `exports` patterns to map deep imports to dist JS**

   - Package `exports` must deterministically resolve:
     - subpaths → `dist/**/*.js`
     - types → `dist/**/*.d.ts`
   - This eliminates split-brain resolution and makes runtime behavior deterministic

4. **Cross-package imports of `shared/src/*` are forbidden**
   - No service may import from `@nv/shared/src/...`
   - No relative imports into `backend/services/shared/src` from other packages
   - All shared consumption goes through the package boundary

## Reasoning

### Root cause clarification

The “same errors after changes” symptom was not accidental. It indicated that edits were often being applied to files that were _not actually executed_.

The investigation showed that:

- `tsx` + `tsconfig-paths` rewrote some imports to TS source
- Node’s package resolver handled others via `exports`
- The existing `exports` wildcard (`"./*": "./dist/*"`) did **not** guarantee resolution to emitted `.js` files
- This caused some imports to resolve to TS, some to JS, and some to fail entirely

As long as this split existed, **any behavioral change could be applied to the wrong copy of a module**, making refactors unreliable.

### Why dist-only runtime is mandatory

Running TS directly in dev:

- Violates dev == prod
- Introduces resolution behavior that does not exist in production
- Masks export and packaging errors until late

Running JS from `dist` everywhere ensures:

- One implementation of each module at runtime
- Resolver behavior matches production
- Instrumentation and logging changes are observable and trustworthy

### Why avoiding a barrel/manifest is required

A central export manifest does not scale for NV:

- Hundreds of DTOs and sidecars would create constant churn
- Missing exports become a new failure mode
- Merge conflicts and drift become inevitable

Deep imports + wildcard exports provide:

- Zero-maintenance exposure of new modules
- Clear ownership by directory
- Stable imports without central coordination

### Why this avoids another configuration tailspin

This decision intentionally limits scope:

- No repo-wide tsconfig rewrites
- No new alias systems
- No TS runtime hooks
- No changes to the runner until resolution is proven correct

By anchoring correctness at the **package boundary**, services can be migrated incrementally and safely.

## Consequences

### Positive

- Single-world runtime (no TS vs dist ambiguity)
- Deterministic deep imports for `@nv/shared`
- True dev == prod behavior
- Eliminates the primary source of “edits that don’t take”
- Scales to hundreds of shared modules without export maintenance

### Costs

- Slower edit-run loop compared to `tsx watch`
  - Mitigated via `tsc -b -w` and process restarts
- Requires discipline: no `/src` imports across packages

### Risks

- Incorrect `exports` configuration can break deep imports
  - Mitigated via resolver probes and staged rollout

## Implementation Notes

This ADR defines intent and constraints; implementation must be staged and probe-driven.

### Stage 0 — Guardrail probes (mandatory)

Resolver probes are the source of truth:

```bash
node -e "console.log(require.resolve('@nv/shared/http/problem'))"
node -e "console.log(require.resolve('@nv/shared/http/handlers/HandlerBase'))"
```

Success means:

Both resolve to backend/services/shared/dist/...

No resolution to shared/src/... in service runtime

Stage 1 — Fix @nv/shared exports

Update package exports so deep imports resolve to emitted .js and .d.ts files under dist/.

Stage 2 — Dist-only service execution

Service dev scripts must execute:

node dist/index.js

Build/watch is allowed; TS execution is not.

Stage 3 — Enforce import discipline

Add CI / ESLint rules to ban:

@nv/shared/src/\*

relative imports into shared/src from other packages

Stage 4 — Incremental rollout

Flip services one at a time:

Fix shared exports

Flip auth

Flip test-runner

Continue outward

At every step:

Run resolver probes

Run minimal smokes

Stop immediately if resolution points to source TS

Alternatives Considered
A) Keep TS runtime in dev

Rejected.

Proven to cause split-brain resolution

Violates dev == prod

Encourages ongoing drift

B) Central barrel export

Rejected.

Brittle at NV scale

High churn and drift risk

C) Rely on tsconfig paths instead of package exports

Rejected.

Tooling behavior, not production behavior

Not applied consistently (as proven by probes)

References

SOP: docs/architecture/backend/SOP.md (Reduced, Clean)

Resolver probe outputs from Jan 1, 2026 investigation

Node.js package exports resolution behavior

Invariant: At runtime, a given module path must resolve to exactly one physical file on disk.
