# ADR-0057 — Shared SvcClient for S2S Calls

## Context

We need a **shared, canonical SvcClient** that all NV services use for service-to-service (S2S) calls.

Design constraints from SOP + LDDs:

- Only the **gateway** is public; all other services are worker services behind S2S.
- All S2S traffic must:
  - Resolve target URL via **svcconfig** (env-backed, no hardcoded ports).
  - Be able to enforce a **call graph** (who can call whom).
  - Carry standard S2S headers and eventually a **KMS-backed JWT**.
- DTOs are canonical and must only leave a process via **DtoBag.toJson()** into a wire envelope (ADR-0050).
- `env-service` and `svcconfig` are the shared discovery/config rails for everything.
- No shims, no “quick” code paths, no env-hardcoded URLs/ports.

We also have a recursion concern:

- SvcClient must use **svcconfig** to discover targets.
- But SvcClient itself needs to call **svcconfig**.
- We don’t want “dog eating its tail” (SvcClient → svcconfig → SvcClient…).

We need:

- A **single shared SvcClient** implementation in `backend/services/shared` that:
  1. Receives `(env, slug, version)` and call details.
  2. Calls svcconfig to resolve a concrete target URL (except when calling svcconfig itself).
  3. Enforces authorization based on svcconfig/graph policy.
  4. Creates a **KMS JWT token** (future; placeholder now).
  5. Builds the outbound payload from a **DtoBag** via `.toJson()`.
  6. Fires the HTTP call and returns the **wire JSON envelope** (caller turns that back into DTOs).

## Decision

We introduce a shared **SvcClient** class with injected dependencies and clear responsibilities.

### 1. Location & Ownership

- File: `backend/services/shared/src/s2s/SvcClient.ts`
- Owned by `shared` package; **all services** (gateway and workers) depend on this for outbound S2S calls.

### 2. Public API

(omitted here for brevity – see full ADR in conversation)

## Consequences

- Single S2S door
- Future-proof auth
- Strict DTO discipline
- Explicit call graph

## Implementation Notes

See full ADR in conversation including resolver, token factory, and body rules.

## Alternatives

1. Hardcode target URLs — rejected.
2. Recursive SvcClient→svcconfig→SvcClient — rejected.
3. Inline per-service clients — rejected.

## References

- SOP
- LDD-00, 03, 12, 16, 19, 33
- ADR-0040, 0047, 0050
