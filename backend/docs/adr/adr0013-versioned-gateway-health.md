// docs/adr/adr0013-versioned-gateway-health.md

# ADR-0013 — Versioned Gateway Health

**Status:** Accepted — 2025-10-06  
**Owners:** Backend Core

## Context

Health endpoints across services are versioned. Gateway previously exposed unversioned health, creating inconsistency and confusion with proxy behavior and smoke tests.

## Decision

Gateway health is **local and versioned**:

- Canonical path: `/api/gateway/v1/health` (and optional `/live`, `/ready` subroutes).
- Never proxied. Mounted **before** any proxy or auth middleware.
- Canonical envelope:  
  `{ ok: true, service: "gateway", data: { status: "live", detail: {...} } }`.

## Consequences

- ✅ Consistency with all services.
- ✅ Eliminates ambiguous proxy matches.
- ⚠ Requires updating any historic scripts referencing unversioned paths.

## Implementation Notes

- Mount early in `GatewayApp`.
- Ensure `/api/gateway/...` is explicitly **excluded** from proxy matching.

## Alternatives

- Keep unversioned `/health` for gateway → contradicts our versioned API rule.

## References

- ADR-0001, ADR-0003, ADR-0006
