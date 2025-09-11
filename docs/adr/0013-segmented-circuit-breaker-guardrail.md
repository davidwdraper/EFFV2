---
id: 0013
title: Segmented circuit breaker guardrail
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [security, guardrail, reliability, circuit-breaker]
---

# Status
Accepted

# Context
Repeated 5xx bursts from specific API areas caused cascading failures and socket exhaustion. Per-service breakers drifted and lacked consistent denial telemetry.

# Decision
Adopt a shared, per-segment (first path token) circuit breaker. Open after N consecutive 5xx; deny with 503 while open; after a cooldown, allow half-open probes to close or re-open. Denials log to SECURITY, not WAL. Env-config via BREAKER_FAILURE_THRESHOLD, BREAKER_HALF_OPEN_AFTER_MS, BREAKER_MIN_RTT_MS.

# Consequences
✅ Fast failure isolation and lower MTTR; ✅ consistent, centralized behavior; ⚠️ state is per-instance unless backed by a distributed store; ⚠️ thresholds require tuning.

# Alternatives Considered
1) Only upstream timeouts (slow, inconsistent). 2) Full-blown service mesh policy (complexity/lock-in). 3) No breaker (cascades). Rejected.

# References
- Design: docs/design/backend/guardrails/circuit-breaker.md\n- Code: backend/services/shared/middleware/circuitBreaker.ts
