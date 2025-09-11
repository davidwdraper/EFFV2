---
id: 0012
title: Gateway edge timeouts guardrail
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [security, guardrail, timeouts, reliability]
---

# Status
Accepted

# Context
Slow or hung upstreams cause socket exhaustion and stalled clients. Inconsistent per-service timeouts made behavior unpredictable and polluted audit trails when triggered late.

# Decision
Introduce a shared timeout middleware mounted before audit and proxy. If no headers are sent within TIMEOUT_GATEWAY_MS, fail with 504 Problem+JSON and emit SECURITY telemetry (not WAL). Clear timers on finish/close; fail-open on internal errors.

# Consequences
✅ Protects resources and reduces tail latency; ✅ clean audit WAL; ⚠️ requires per-env tuning; ⚠️ risk of premature 504s if budgets are mis-set.

# Alternatives Considered
1) Rely on upstream/service timeouts only (inconsistent). 2) Full circuit breaker only (slower detection). 3) No edge timeout (resource exhaustion). Rejected.

# References
- Design: docs/design/backend/guardrails/timeouts.md\n- Code: backend/services/shared/middleware/timeout.ts
