---
id: 0035
title: Ports & Adapters Stabilization for S2S Resolution and Edge JWT
date: 2025-09-28
status: Proposed
deciders: [David Draper]
tags: [architecture,  svcconfig,  gateway,  s2s,  jwt,  jose,  modularity,  ports,  adapters]
---

# Status
Proposed

# Context
A recent refactor moved the source of service-to-service (S2S) URLs and discovery logic from per-service environment variables to a centralized svcconfig mirror. Despite being a seemingly localized change, it cascaded across dozens of files and broke previously passing smoke tests.

Root causes:
- Import-time side effects (environment assertions, svcconfig reads, crypto imports) cause services to hard-bind to implementation details.
- The shared package exposes utilities with side-effects (env, config, HTTP, JWT), creating wide coupling.
- No dedicated ServiceDirectory adapter forces every consumer to know svcconfig’s internal shape.
- ESM-only libraries like jose were required at top-level in CommonJS builds, leading to runtime errors.
- Gateway policy middleware performed cryptographic work before configuration stabilized, causing early failures.

These factors violated the intended microservice isolation, making small design changes ripple through the entire backend.

# Decision
Introduce explicit **ports** and **adapters** to isolate cross-cutting concerns and stop import-time side effects:

1) Stable Ports
   - ServiceDirectory: getBase(slug, version) returns URL parts using only the local svcconfig mirror.
   - JwtVerifier: verifyUser(bearer) returns claims; internally performs lazy ESM import of jose to stay compatible with CJS.

2) Single-File Adapters
   - svcconfig/serviceDirectory.mirror.ts implements ServiceDirectory.
   - security/jwtVerifierJose.ts implements JwtVerifier using native dynamic import ((0,eval)('import("jose")')).

3) Gateway Policy Middleware
   - Calls JwtVerifier only inside the request handler.
   - Bypasses public and health routes early to avoid unnecessary crypto work.

4) HttpClientBySlug
   - Resolves upstreams only through ServiceDirectory.
   - Sets bounded timeouts (connect ≤500ms; total ≤10s dev / 3s prod) and disables retries for POST.

5) Environment Discipline
   - All environment validation and configuration happens during bootstrap, never at import time.

6) Contract Tests
   - New tests freeze the surface of ServiceDirectory and HttpClientBySlug to detect accidental coupling.

This concentrates future S2S changes inside one adapter file and ensures JWT verification is late-bound and testable.

# Consequences
Pros:
- Strict separation of ports and adapters localizes changes; future S2S discovery edits no longer break unrelated services.
- No network I/O or crypto at import time reduces startup fragility and improves testability.
- Centralized ServiceDirectory and JwtVerifier contracts make correctness and performance observable and enforceable.
- Using native dynamic import of jose avoids ESM/CJS runtime traps while the repo remains CommonJS.

Tradeoffs:
- Slightly more boilerplate: factories for each port and one indirection to call adapters.
- Requires a contract test suite to keep the port surface stable.

Operational Impacts:
- All S2S URL lookups and JWT verification flow through the new adapters.
- Smoke and contract tests validate the ports before merging.
- Future ADRs can safely upgrade node moduleResolution or migrate to ESM knowing ports remain stable.

Security & Audit:
- JwtVerifier adapter provides a single point to enforce issuer/audience and clock skew checks.
- Centralized ServiceDirectory ensures audit logs and metrics can track all svcconfig-based resolutions.

# Alternatives Considered
1) Keep current shared utils with side effects — Rejected. Maintains tight coupling and import-time fragility.
2) Immediate full ESM migration — Deferred. Requires synchronized changes across all services; better done after ports are stable.
3) Service mesh-only discovery — Deferred. Heavy infra and incompatible with the current gateway-centric security model.
4) Push S2S discovery back to per-service env vars — Rejected. Returns to duplicated config and higher operational risk.

# References
- SOP: docs/architecture/backend/SOP.md
- ADR-0030: Gateway-only KMS signing and JWKS
- ADR-0032: Route policy via svcconfig + ctx-hop tokens
- ADR-0033: Centralized env loading and deferred config
- ADR-0034: Centralized service discovery via gateway
- Health/Readiness ADR: docs/adr/0016-standard-health-and-readiness-endpoints.md
- svcconfig overview: docs/architecture/backend/svcconfig/OVERVIEW.md
