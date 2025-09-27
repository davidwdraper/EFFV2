---
id: 0034
title: Centralized Service Discovery via Gateway; Dual-Port Gateway; Internal-Only S2S JWKS
date: 2025-09-27
status: Proposed
deciders: [David Draper]
tags: [discovery,  gateway,  jwks,  svcconfig,  s2s,  security,  ops,  ports,  proxy]
---

# Status
Proposed

# Context
We are greenfield with multiple TypeScript microservices behind a gateway. Services often call each other (S2S) by slug and verify tokens via JWKS. Historically, each service carried SVCCONFIG_BASE_URL, coupling N services to a moving target and duplicating discovery logic. The gateway already knows svcconfig (self-referential entry in DB) and can cache slug→baseUrl. We also need clean separation between public edge and internal control-plane so internal discovery and S2S JWKS are never exposed on the public port. Goals:
- Minimize per-service env surface and brittleness.
- Centralize discovery and cross-cutting policy (auth, retries, timeouts, circuit-breaking).
- Separate public and internal traffic/keys with clear blast radius and network policy.
- Keep migration simple for run.sh, smoke tests, and CI.

# Decision
Adopt gateway-centered discovery and dual-port topology:
1) Per-Service Env Simplicity
   - Each service knows exactly one endpoint: GATEWAY_INTERNAL_BASE_URL (e.g., http://127.0.0.1:4001).
   - Services DO NOT carry SVCCONFIG_BASE_URL. Ever.

2) Gateway as Source of Truth
   - Gateway owns svcconfig integration and maintains an in-memory, TTL'd cache of slug→baseUrl.
   - Provide internal endpoints:
     - GET /_internal/svcconfig/base-url
     - GET /_internal/svcconfig/resolve/:slug
     - (Preferred) Proxy: ANY /internal/call/:slug/* → forwards to resolved service with uniform auth/backoff.

3) Dual Ports (Listeners)
   - Public Edge (e.g., :4000): user-facing API only; may expose public JWKS for user/3P tokens if needed.
   - Internal Plane (e.g., :4001): discovery endpoints, S2S proxy, S2S JWKS, light internal health. Restricted to VPC/loopback/mTLS + S2S JWT.

4) JWKS Placement & Key Scope
   - S2S JWKS (issuer=a gateway-internal issuer; aud=internal-services) is INTERNAL-ONLY.
   - Public JWKS (if required) uses separate keys/issuer/audience and lives on the public edge. Do not mix key purposes.

5) Client Options
   - Default path is gateway proxy for S2S (uniform policy in one place).
   - Optional: services may fetch resolved baseUrl once from gateway and cache locally (short TTL) for direct calls, honoring gateway-provided cache headers.

6) Operational Guardrails
   - Internal endpoints require S2S JWT and are not routable publicly.
   - Gateway metrics expose cache hit/miss, resolve latency, and proxy outcomes for smoke/ops.

# Consequences
Pros:
- Single dependency per service (gateway); eliminates N copies of discovery and reduces env drift.
- Clear security boundaries: internal discovery/JWKS never on public edge.
- Centralized retries, backoff, timeouts, and auth at the proxy; consistent SLOs and simpler debugging.
- Easier key rotation and policy changes: services hit one JWKS issuer on internal port.

Tradeoffs:
- Gateway is on the hot path for discovery and proxy; needs proper sizing and caching.
- Slight complexity to run two listeners and maintain internal network policy.
- If services choose direct calls (optional path), they must respect cache TTL and fallback to proxy on miss.

Operational Impacts:
- run.sh sets GATEWAY_INTERNAL_BASE_URL for all services.
- Smoke tests add coverage for internal JWKS, resolve endpoints, and proxy paths.
- Network policy/firewall rules must isolate internal port; mTLS optional but recommended in multi-host setups.

Security & Audit:
- Separate key material and issuers for internal vs public tokens.
- Internal endpoints are S2S-authenticated; logs/metrics provide auditability of resolution and proxy behavior.
- Blast radius reduction: svcconfig outages primarily impact gateway; services degrade predictably.

# Alternatives Considered
1) Per-service SVCCONFIG_BASE_URL — Rejected.
   Brittle, duplicated logic, harder rotations, wider blast radius.

2) Direct DB access to svcconfig from each service — Rejected.
   Spreads DB credentials and schema coupling across the fleet; violates layering.

3) Single-port gateway (public+internal mixed) — Rejected.
   Blurred trust boundary; risky exposure of discovery/JWKS; complicated network policy.

4) Service-to-service mesh-only discovery (no gateway role) — Deferred.
   Adds heavy infra (control plane, sidecars) and conflicts with our gateway-centric policy enforcement today.

5) Always resolve client-side (no gateway proxy) — Considered.
   Loses centralized retries/backoff/policy; optional fallback only, not the default.

# References
- SOP: docs/architecture/backend/SOP.md
- ADR-0030: gateway-only KMS signing and JWKS
- ADR-0032: Route policy via svcconfig + ctx-hop tokens
- ADR-0033: Centralized env loading & deferred config
- Health/Readiness ADR: docs/adr/0016-standard-health-and-readiness-endpoints.md
- svcconfig Overview: docs/architecture/backend/svcconfig/OVERVIEW.md
