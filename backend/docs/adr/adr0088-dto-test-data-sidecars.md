adr0088-dto-test-data-sidecars

# ADR-0088: DTO Test Data Sidecars (Deterministic tdata)

## Status
WIP — Design intent captured, implementation deferred.

## Context

NowVibin backend handler tests have reached a point where **manual, ad-hoc DTO population inside tests is no longer acceptable**.

Problems observed:
- Tests duplicate DTO knowledge (field names, requiredness, semantics).
- DTO shape changes require touching many tests → drift and skipped updates.
- Engineers are incentivized to “just make the test pass” instead of honoring DTO truth.
- Randomized or inline test data makes failures hard to reason about and reproduce.

At the same time, we explicitly **do not want**:
- A separate manifest or schema that mirrors DTO shape (goes stale).
- Runtime reflection hacks.
- Test-only metadata scattered across the codebase.

DTOs are already the canonical truth. Tests must consume that truth, not re-encode it.

## Decision (Proposed)

Introduce **DTO Test Data Sidecars** with the following properties:

### 1) One sidecar per DTO
For each DTO `<name>.dto.ts`, there may exist a companion:

- `<name>.dto.tdata.ts`

Example:
- `user.dto.ts`
- `user.dto.tdata.ts`

The sidecar contains **deterministic test data only**.

### 2) Sidecars contain only “happy path” data
- Sidecars define **exactly one canonical happy dataset** per DTO.
- No sad paths, no variants, no branching logic.
- No randomness.

The sidecar is a **golden fixture**, not a generator.

### 3) DTO remains the sole authority on shape
- The DTO defines structure, types, required fields, validation.
- The sidecar does **not** redefine shape.
- The sidecar must align with the DTO or generation fails.

### 4) Minimal test-intent metadata lives in the DTO
DTOs may expose a small, optional metadata hook (e.g. `tdataMeta()`), used only for:
- Declaring semantic intent that cannot be inferred from TypeScript alone  
  Examples: `email`, `humanName`, `isoDate`, numeric ranges
- This metadata:
  - is keyed by field name
  - must reference real fields
  - contains no structural duplication (no “kind”, no type)

This metadata is **co-located with the DTO** so it cannot drift independently.

### 5) Sidecars are generated (not handwritten long-term)
- A build-time tool will:
  - parse DTO source
  - infer field names, types, optionality
  - merge DTO-provided test intent metadata
  - generate `<name>.dto.tdata.ts`
- Generated files are deterministic and checked into the repo.
- CI will fail if generated output changes unexpectedly.

### 6) Registry owns test variants
The DTO Registry (test mode only) is responsible for producing variants:

- happy
- missing required field
- duplicate
- malformed, etc.

Tests request **intent**, not data:

```ts
registry.mint("user", "happy");
registry.mint("user", "missingRequired", { field: "email" });
```

Tests never manually populate DTOs.

## Consequences

### Positive
- DTO changes immediately surface in tests.
- No duplicated DTO knowledge in test code.
- Deterministic, readable test data.
- Tests become shorter, clearer, and harder to “cheat”.
- Encourages engineers to keep DTOs honest and complete.

### Trade-offs
- Requires initial tooling work (AST parsing / generation).
- Requires discipline: sidecars are fixtures, not playgrounds.
- Tests must be refactored to use registry-minted DTOs.

These costs are accepted in exchange for long-term correctness and velocity.

## Non-Goals (Explicit)

This ADR does **not** decide:
- The exact AST tooling or library.
- The final API shape of the registry mutation helpers.
- How many variant types are supported initially.

Those are implementation details to be addressed incrementally.

## Implementation Notes (Deferred)

Suggested rollout:
1. Prototype with one DTO (manual `*.dto.tdata.ts`).
2. Update registry to consume sidecar for happy path.
3. Refactor one pipeline’s tests to use registry-minted DTOs.
4. Only then automate generation.

## References
- ADR-0040 (DTO-Only Persistence)
- ADR-0047 (DtoBag & Views)
- ADR-0073 (Handler-Level Test Runner)
- LDD-35 (Handler Test Runner Architecture)
