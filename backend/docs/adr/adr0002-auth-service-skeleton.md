# ADR-0002 — Auth Service Skeleton (No Minting)

**Status:** Proposed — 2025-09-30  
**Related:** ADR-0001 (Gateway-Embedded SvcConfig + Separate svcFacilitator), SOP (Core Backend)

## Context

We are rebuilding the backend with strict TS OO + DI. Gateway and svcfacilitator are up; SvcClient/SvcReceiver exist and are the canonical S2S language carriers. We now need the **auth** service online (health + scaffolding only) so the gateway can proxy to it and we can later add minting and user calls.

## Decision

- Create a new `auth` microservice using the standard service blueprint and shared **Bootstrap**.
- Expose only:
  - `GET /api/auth/health/live`
  - `GET /api/auth/health/ready`
- No JWT minting, no user calls yet. No DB required at this step.
- Register service with svcfacilitator as `slug=auth`, `version=1`, `baseUrl=http://127.0.0.1:4010` (align with current mirror).
- Inbound processing uses **SvcReceiver**; outbound (later) uses **SvcClient**.
- Use RFC7807 for errors; include `x-request-id` and standard S2S headers by convention.

## Consequences

- Minimal surface area to validate plumbing (client → gateway → auth), enabling quick smoke tests.
- Establishes the code layout and DI pattern that all subsequent services will follow.
- Defers minting/JWKS until ADR-0003 (Crypto/JWT Mint & UserAuth) to keep steps small and testable.

## Implementation Notes

- Folder layout mirrors other services:
  - `src/bootstrap/` — reuse shared Bootstrap class
  - `src/app.ts` / `src/index.ts` — app factory + entry
  - `src/routes/health.ts` — live/ready endpoints
  - `src/middleware/` — requestId + basic logging hooks (shared if available)
  - `src/controllers/` — `HealthController` class (pure OO, thin)
- **DI:** Constructor-inject any dependencies (logger, config). No singletons; avoid global state.
- **Headers:** Always set `x-request-id`; use consistent S2S headers even on health (cheap invariants).
- **Env:** `.env.dev` with `PORT=4010`. Comments must use `#` (not `//`) to remain shell-sourceable.
- **Gateway:** Add pass-through proxy rules in later step; for this ADR we only stand up service.

## Alternatives

- Stand up auth with minting immediately → rejected (bigger blast radius; slower iteration).
- Skip SvcReceiver for health-only endpoints → rejected (breaks pattern consistency).

## References

- SOP: NowVibin Backend — Core SOP (Reduced, Clean)
- ADR-0001: Gateway-Embedded SvcConfig + Separate svcFacilitator
- RFC 7807 (problem+json)
