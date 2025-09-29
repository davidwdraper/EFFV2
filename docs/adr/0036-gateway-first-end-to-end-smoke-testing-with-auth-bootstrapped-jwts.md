---
id: 0036
title: Gateway-First End-to-End Smoke Testing with Auth-Bootstrapped JWTs
date: 2025-09-28
status: Proposed
deciders: [David Draper]
tags: [testing,  smoke,  e2e,  gateway,  auth,  jwt,  security,  ci]
---

# Status
Proposed

# Context
Smoke tests have been intermittently green but fail to catch integration regressions when services are exercised directly or with ad hoc tokens. We need the smoke harness to emulate a real client traversing the public gateway, so changes to edge policy, routing, or JWT verification are always under test. Health checks and explicitly anonymous routes remain exceptions.

Problem symptoms:
- Tests calling downstream services directly bypass gateway policy.
- Inconsistent token acquisition leads to drift from production flows.
- Refactors at the gateway edge (policy, JWT libs, timeouts) escape test coverage.
- Multiple interfaces under test increase fragility and confusion.

# Decision
Adopt a **Gateway-First E2E** testing model for all smoke tests except health and explicitly anonymous scenarios.

1) Single Public Interface
   - All smoke tests (except health/anon) must call the **public gateway port** (e.g., :4000).
   - No direct calls to downstream service ports in smoke tests.

2) Auth-Bootstrapped JWT
   - A shared test library function performs a client-like bootstrap:
     a) POST /api/auth/V1/auth/create with a mock email/password (gateway).
     b) POST /api/auth/V1/auth/login (gateway) to obtain a **user JWT**.
     c) Cache the JWT in the test session and attach it to subsequent requests as 'Authorization: Bearer ...'.
   - Library provides helpers:
     - get_test_jwt() → returns cached or freshly minted JWT
     - with_auth curl ... → automatically injects the header
     - cleanup_test_user() → delete user at teardown (idempotent)

3) Explicit Exceptions
   - Health: /health/live and /health/ready remain unauthenticated and may be called directly or via gateway.
   - Public/anonymous routes: may be exercised without JWT but still via gateway.

4) Determinism & Hygiene
   - Use deterministic mock identities per test run (e.g., smoke+<timestamp>-<rand>@example.test).
   - Short-lived JWT TTL for tests; clock skew tolerance configured in gateway.
   - Test data teardown is mandatory when the flow creates durable records.

5) Timeouts & Observability
   - Gateway timeouts for smoke set to dev-sane defaults (connect ≤500ms; total ≤10s).
   - Breadcrumb logging (reqId, upstream target, phases) on both gateway and services for diagnosis.

6) CI Integration
   - CI harness exports GATEWAY_BASE_URL and forbids direct service URLs in smoke env.
   - Contract tests cover auth bootstrap helpers to prevent silent breakage.

# Consequences
Pros:
- Tests always cover gateway policy, routing, and JWT verification—real client path.
- One stable interface reduces per-test boilerplate and drift.
- Regressions in edge logic are caught early; fewer surprises after refactors.

Tradeoffs:
- Slightly longer test times due to auth bootstrap.
- Requires consistent teardown to avoid data buildup.

Operational Impacts:
- New smoke lib file (e.g., scripts/smoke/lib/auth_jwt.sh) shared by tests.
- Existing smoke tests updated to use with_auth/get_test_jwt helpers.
- CI must ensure gateway is up before running authenticated tests.

Security & Audit:
- Test-only identities and short TTL tokens limit risk.
- Logs correlate reqId across gateway and services for reliable triage.

# Alternatives Considered
1) Keep mixed direct-service + gateway tests — Rejected. Misses edge regressions and causes drift.
2) Pre-mint tokens in scripts — Rejected. Falls out of sync with real auth flows and key rotation.
3) Full service mesh e2e bypassing gateway — Rejected for now; conflicts with gateway-centric security model.
4) Per-test bespoke auth code — Rejected. Duplicates logic and invites inconsistencies.

# References
- SOP: docs/architecture/backend/SOP.md
- ADR-0016: Standard health and readiness endpoints
- ADR-0030: Gateway-only KMS signing and JWKS
- ADR-0032: Route policy via svcconfig and ctx-hop tokens
- ADR-0033: Centralized env loading and deferred config
- ADR-0035: Ports & Adapters stabilization for S2S + Edge JWT
