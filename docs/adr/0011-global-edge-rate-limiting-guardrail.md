---
id: 0011
title: Global edge rate limiting guardrail
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [security, guardrail, rate-limit]
---

# Status
Accepted

# Context
Public endpoints saw abusive bursts and accidental thundering herds. Per-service ad hoc limiters drifted and polluted billing audit with denials.

# Decision
Introduce a shared fixed-window rate limiter keyed by (IP+method+path). Mount before proxy and before audit. Denials log to SECURITY (not WAL) and return RFC7807 with Retry-After. Default config from env: RATE_LIMIT_POINTS, RATE_LIMIT_WINDOW_MS.

# Consequences
✅ Backstop abuse cheaply; ✅ clean audit WAL; ⚠️ in-memory store requires swap to distributed store for horizontal scale; ⚠️ tune limits per environment.

# Alternatives Considered
1) No global limiter (risk). 2) Vendor gateway only (lock-in). 3) Per-route bespoke logic (drift/complexity). Rejected.

# References
- Design: docs/design/backend/guardrails/rate-limit.md\n- Code: backend/services/shared/middleware/rateLimit.ts
