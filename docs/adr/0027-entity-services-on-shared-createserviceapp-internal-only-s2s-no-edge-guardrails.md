---
id: 0027
title: Entity services on shared createServiceApp (internal-only S2S, no edge guardrails)
date: 2025-09-12
status: Accepted
deciders: [Platform Team]
tags: [entity-service, internal-only, s2s, shared-stack]
---

# Status
Accepted

# Context
Entity services (e.g., act) must use the shared internal service stack and enforce S2S after health. Edge guardrails (rate limit, timeouts, breaker, public auth) live only in the public gateway per ADR-0015/0021. This eliminates bespoke Express wiring and prevents drift.

# Decision
Adopt @eff/shared/src/app/createServiceApp with order: requestId→httpLogger→problemJson→trace5xx(early)→health (open)→verifyS2S→parsers→routes→404→error. Use @eff/shared/src/env for repo→family→service env cascade and assert minimal required vars.

# Consequences
Uniform telemetry and security posture across all entity services; reduced custom code; tests calling /api/* without S2S now fail fast with 401/403.

# Alternatives Considered
Keep bespoke per-service assembly (drift, repeated logic); add edge guardrails to entity services (policy violation per ADR-0015/0021).

# References
- SOP: docs/architecture/backend/SOP.md
