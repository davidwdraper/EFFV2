// docs/adr/adr0014-base-hierarchy-serviceentrypoint-and-servicebase.md

# ADR-0014 — Base Hierarchy: ServiceEntrypoint vs ServiceBase

**Status:** Accepted — 2025-10-06  
**Owners:** Backend Core

## Context

We mixed "composition/root" bootstrapping with "inheritance base" concerns. A global logger provider crept in, and classes lacked a single, reliable source for env/logger/config.

## Decision

Split responsibilities:

1. **ServiceEntrypoint** (composition root; not a superclass)

   - Starts process, loads envs, builds Express app via hook, binds signals.
   - No cross-cutting singletons; no global logger.

2. **ServiceBase** (inheritance root; superclass)
   - Provides `this.log` and `this.env` (and later config/metrics/clock).
   - All runtime classes (controllers, repos, routers) extend this.

**Supersessions:**

- Supersedes prior “ServiceBase as entrypoint” concept (previously referenced as ADR-0009 in headers). ADR-0009 is **withdrawn** in favor of this ADR.

## Consequences

- ✅ Cleaner OO layering and testability.
- ✅ No global logger mutation; simpler ownership and lifecycles.
- ⚠ One-time refactor: rename old bootstrap class to `ServiceEntrypoint`; migrate call sites.

## Implementation Notes

- Rename file `shared/bootstrap/ServiceBase.ts` → `shared/bootstrap/ServiceEntrypoint.ts` (no behavior change).
- Introduce `shared/base/ServiceBase.ts` as the inheritance root; update `ControllerBase`, `RepoBase`, and routers to extend it.
- Remove usages of `logger.provider` as classes migrate to `ServiceBase`.

## Alternatives

- Keep combined base → keeps confusion and hidden globals.
- DI container for everything → overkill for current scope.

## References

- ADR-0001, ADR-0003, ADR-0013
