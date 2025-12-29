adr0087-index-pipelines-seed-filter-handlers

# Context

NV pipelines have been drifting toward allowing implicit seeding logic inside
`index.ts` files (inline filter objects, undeclared variables, inferred ctx
dependencies). This causes:

- Hidden handler dependencies (db handlers relying on ctx keys with no explicit producer)
- Pipelines that are harder to read, audit, and refactor
- Errors that surface late (compile/runtime) instead of being obvious at design time

Under the SOP, pipelines must be self-describing manifests, not places where logic
quietly accumulates.

# Decision

1. `index.ts` files are for defining and ordering handlers only.

   - No seeding logic
   - No inline filter construction
   - No inferred ctx manipulation
   - No anonymous or ad-hoc setup code

2. If a `db.*` handler requires ctx data to fulfill its responsibility,
   it MUST be preceded by an explicit seed handler.

3. Seed handlers are pipeline-local and explicitly named.

   - Their sole responsibility is to construct and stash ctx data
     required by subsequent handlers.

4. Seed handlers intentionally DO NOT use the `code.` prefix.
   - Seeding is contextual preparation, not reusable logic.
   - Its intent is inferred by position and filename.
   - Using `code.` would incorrectly suggest generic reuse.

# Seed Handler Naming Convention

- If the pipeline has a single seed step:

  seed.filter.ts

- If the pipeline has multiple seed steps:

  seed.filter1.ts  
  seed.filter2.ts

Numbering is positional, not semantic.

# Seed Handler Rules

Seed handlers:

- Extend `HandlerBase`
- Are colocated with the pipeline
- Have a colocated `.test.ts`
- Explicitly document:
  - ctx keys they read
  - ctx keys they write
  - which downstream handler(s) depend on those keys

Seed handlers are:

- pipeline-specific
- declarative
- preparatory
- non-reusable by default

# Consequences

## Positive

- Pipelines become readable manifests: seed → db → code → response
- All ctx dependencies are explicit and auditable
- Compile errors point directly to missing seed steps
- Refactors become safer and mechanical

## Tradeoffs

- Slightly more files (one seed handler instead of inline logic)
- Requires discipline to resist “just define a const in index.ts”

# Implementation Notes

- Applies to all pipelines under:

  controllers/<route>.controller/<purpose>.pipeline/\*

- Rule of thumb:

  If a `db.*` handler needs `ctx["bag.query.filter"]` (or similar),
  the immediately preceding step must be `seed.filter*.ts`.

- `index.ts` MAY contain:

  - imports
  - `getSteps()` returning instantiated handlers in order

- `index.ts` MUST NOT contain:
  - filter construction
  - ctx seeding logic
  - undeclared variables used by handlers

# Alternatives Considered

1. Allow small inline filters in `index.ts`  
   Rejected — encourages hidden dependencies and gradual drift.

2. Let db handlers build their own filters  
   Rejected — violates single-responsibility and “handlers don’t go fishing.”

3. Move all filter building into shared helpers  
   Rejected — increases shared surface area and hides pipeline intent.

# References

- SOP: Rails Are Law
- ADR-0041 (Per-route controllers; single-purpose handlers)
- ADR-0042 (HandlerContext Bus — KISS)
- ADR-0050 (Wire Bag Envelope — items[] + meta)
