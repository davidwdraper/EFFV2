---
id: 0015
title: Edge guardrails stay in gateway (remove from shared)
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [security, architecture, guardrails, shared]
---

# Status
Accepted

# Context
Edge-only middleware (rate limiting, edge timeouts, circuit breaker, client auth, CORS/HSTS, proxy plane) leaked into shared. In a multi-dev team this invites misuse: workers accidentally mount edge guardrails on S2S paths, causing self-DOS, inconsistent behavior, and security drift.

# Decision
Keep shared limited to cross-cutting, internal-safe pieces (requestId, http logger, problem+json, error handler, 5xx tracer, audit capture, env asserts). All edge guardrails remain in gateway/gateway-core only. Update createServiceApp to exclude edge guardrails entirely; gateway assembles its own edge stack. Document this as a hard rule.

# Consequences
✅ Clear trust boundary; ✅ fewer footguns; ✅ simpler mental model; ⚠️ small refactor to remove edge code from shared; ⚠️ two assembly paths (gateway vs service) to maintain—acceptable per SOP.

# Alternatives Considered
1) Keep edge code in shared behind flags (still risky—flags drift). 2) Rely on code reviews (not reliable at scale). 3) Service mesh policies only (lock-in/complexity). Rejected.

# References
- SOP: docs/architecture/backend/SOP.md\n- Addendum 2 — Security & S2S Authorization\n- ADR 0011 Global edge rate limiting\n- ADR 0012 Gateway edge timeouts\n- ADR 0013 Segmented circuit breaker
