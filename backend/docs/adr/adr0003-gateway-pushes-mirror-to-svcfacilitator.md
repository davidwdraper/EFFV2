// docs/adr/adr0003-gateway-pushes-mirror-to-svcfacilitator.md

# ADR0003 — Gateway pushes svcconfig mirror to svcfacilitator

- **Status:** Accepted
- **Date:** 2025-09-30
- **Context:** Gateway always maintains a hot or LKG mirror of service-configs. We need svcfacilitator to serve S2S lookups without coupling it to the DB. Pub/sub adds complexity we don’t need.
- **Decision:**
  - Gateway **pushes** the full mirror to svcfacilitator via `POST /mirror/load` on boot and after every mirror refresh (change stream or poll).
  - svcfacilitator **stores mirror in-memory** (no DB) and will serve read endpoints (e.g., `/svc/:slug/url`) from this store.
- **Consequences:**
  - Simpler than pub/sub. Strong coupling to gateway availability is acceptable for dev.
  - Large mirrors travel over HTTP; acceptable for current scale. Optimize later if needed (diffs/etags).
