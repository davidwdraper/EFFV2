// docs/adr/adr0004-auth-service-skeleton.md

# ADR-0004 — Auth Service Skeleton (No JWT Minting Yet)

**Status:** Accepted — 2025-10-06  
**Owners:** Backend Core

## Context

We need an Auth service online early for plumbing and integration, but full JWT minting, refresh flows, and crypto/JWKS rotation add complexity. Early tests focus on health, wiring, and controller scaffolding.

## Decision

Stand up Auth as a minimal service with:

- Versioned health endpoints.
- Mock password hashing (placeholder).
- No token minting/verification yet.
- Thin controllers + shared Base wiring.

## Consequences

- ✅ Fast integration testing (gateway ↔ auth).
- ⚠ Requires follow-up ADR to enable real JWT minting and verification before any production traffic.

## Implementation Notes

- Routes: `/api/auth/v1/health/{live,ready}`.
- Controllers extend our base (post ADR-0014).
- Keep mock hashing isolated to enable drop-in replacement later.

## Alternatives

- Build full JWT stack now → slower path, more moving parts before baseline is green.

## References

- ADR-0001 (Gateway-Embedded SvcConfig)
- ADR-0003 (Gateway pulls svc map)
