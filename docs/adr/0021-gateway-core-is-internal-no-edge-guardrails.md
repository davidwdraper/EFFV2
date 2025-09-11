---
id: 0021
title: Gateway-core is internal; no edge guardrails
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [security, architecture, separation-of-concerns]
---

# Status
Accepted

# Context
Developers have accidentally reused public edge middleware inside gateway-core. This blurs trust boundaries and creates brittle, duplicated controls.

# Decision
Gateway-core is strictly internal S2S. It must not mount edge guardrails: no public CORS/HSTS, no rateLimit/timeouts/circuitBreaker, no client auth gate, no proxy plane (injectUpstreamIdentity/serviceProxy). Gateway-core mounts: requestId, http logger, problem+json, trace5xx(early), health (open), verifyS2S, readOnlyGate (optional), parsers, routes, 404, error handler.

# Consequences
✅ Clear trust boundary; ✅ simpler audits; ✅ fewer surprises; ⚠️ some duplication pressure (resist by keeping edge-only code in gateway).

# Alternatives Considered
1) Share edge guardrails in shared (risk of misuse). 2) Put guardrails in every service (drift, perf, complexity). Rejected.

# References
- SOP: docs/architecture/backend/SOP.md\n- ADR: docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md\n- Code: backend/services/shared/app/createServiceApp.ts
