// docs/adr/adr0002-svcfacilitator-minimal.md

# ADR0002 — Service Facilitator (svcfacilitator) minimal service

- **Status:** Accepted
- **Date:** 2025-09-29
- **Context:** We need a tiny S2S helper to centralize service discovery and mirror ops without coupling every caller to gateway internals. No DB; JWKS/S2S security later.
- **Decision:**
  - Create `svcfacilitator` service with two endpoints:
    - `POST /mirror/load` — trigger upstream mirror refresh (for now, a no-op placeholder).
    - `GET  /svc/:slug/url` — return baseUrl for a slug (version default 1).
  - Use shared `Bootstrap`. No DB; no JWKS yet. Health via shared HealthService (process-only).
  - Alias `@nv/shared` for dependencies.
- **Consequences:**
  - Adds a small hop for S2S discovery but keeps gateway clean.
  - Later: add JWKS validation + S2S auth, and wire to gateway via SvcClient/SvcReceiver.
