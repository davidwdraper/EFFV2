// docs/adr/adr0015-structured-logger-with-bind.md

# ADR-0015 — Structured Logger with `bind()` Context

**Status:** Accepted — 2025-10-06  
**Owners:** Backend Core

## Context

We need a single logging API that supports structured context binding (`.bind(ctx)`) across all services and layers. Prior ad-hoc providers lacked a standard `bind()` and encouraged globals.

## Decision

Introduce a shared logger module that:

- Exposes `setRootLogger()` to install the process logger once at boot.
- Exposes `getLogger()` returning a logger object that supports `.bind(ctx)`.
- Ensures all log calls can attach contextual fields without global mutation.

## Consequences

- ✅ Consistent logging API and easy per-class/request scoping.
- ✅ Removes need for global logger providers in business code.
- ⚠ Requires updating imports to `@nv/shared/logger/Logger`.

## Implementation Notes

- File: `backend/services/shared/src/logger/Logger.ts`
- `ServiceEntrypoint` will call `setRootLogger(boot.logger)` during boot.
- All runtime classes obtain a logger via `getLogger().bind({ service, component })`.

## Alternatives

- Keep provider pattern without `bind()` → inconsistent context, harder correlation.
- Adopt DI container now → overkill for current scope.

## References

- ADR-0014 (Base Hierarchy)
- ADR-0006 (Edge Logging)
- ADR-0013 (Versioned Gateway Health)
