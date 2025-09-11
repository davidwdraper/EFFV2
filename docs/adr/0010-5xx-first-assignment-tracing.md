---
id: 0010
title: 5xx first-assignment tracing
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [observability, debugging, telemetry]
---

# Status
Accepted

# Context
5xx statuses may be set in disparate layers (handlers, proxy, framework). Without attribution to the first setter, incident triage requires guesswork and long log spelunking.

# Decision
Introduce a shared trace5xx middleware that shims res.status/sendStatus/writeHead to log the first assignment of a 5xx, emitting a compact repo-local stack and a stable sentinel (<<<500DBG>>>). Mount an early instance before guardrails; optionally a late instance near proxying.

# Consequences
✅ Faster root-cause pinpointing; ✅ low overhead; ⚠️ requires careful mount order to be useful; ⚠️ stack filters must be tuned per repo layout.

# Alternatives Considered
1) Rely on generic error logs (often late). 2) Full APM with deep hooks (cost/opacity). 3) No tracing (slow MTTR). Rejected.

# References
- Design: docs/design/backend/observability/trace5xx.md\n- Code: backend/services/shared/middleware/trace5xx.ts
