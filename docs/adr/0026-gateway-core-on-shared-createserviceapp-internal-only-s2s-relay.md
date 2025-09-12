---
id: 0026
title: Gateway-core on shared createServiceApp (internal-only S2S relay)
date: 2025-09-12
status: Accepted
deciders: [Platform Team]
tags: [gateway-core, internal-only, s2s, proxy, shared-stack]
---

# Status
Accepted

# Context
Gateway-core must be a minimal internal S2S relay: verify inbound S2S, mirror svcconfig, and proxy to workers while minting outbound S2S. It should use the shared internal app stack and have no edge guardrails.

# Decision
Adopt @eff/shared/src/app/createServiceApp with order requestId→httpLogger→problemJson→trace5xx(early)→health (open)→verifyS2S (inbound)→parsers→routes(/api→genericProxy)→404→error. Keep svcconfig readiness with warmup grace.

# Consequences
Consistent telemetry and error formatting; zero business logic in gateway-core. Only potential change is body-parsing order (genericProxy must tolerate parsed JSON if present).

# Alternatives Considered
Keep bespoke assembly; or add edge guardrails in gateway-core (rejected by ADR-0015/0021).

# References
- SOP: docs/architecture/backend/SOP.md
