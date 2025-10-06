// docs/adr/adr0009-servicebase-class-entrypoint-withdrawn.md

# ADR-0009 — ServiceBase as Class-Based Entrypoint (Withdrawn)

**Status:** Withdrawn — 2025-10-06  
**Owners:** Backend Core

## Context

Earlier, we framed a single `ServiceBase` that did both bootstrapping (entrypoint) and shared concerns (logger/env).

## Decision

**Withdraw** this approach. It is replaced by **ADR-0014**, which splits composition (`ServiceEntrypoint`) from inheritance (`ServiceBase`).

## Consequences

- ✅ Clear layering; no global logger.
- ⚠ Update headers that referenced ADR-0009 to reference ADR-0014 (or remove if obsolete).

## References

- ADR-0014 (replacement)
