---
id: 0008
title: Global error boundary & logging discipline
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [errors, observability, ops, telemetry]
---

# Status
Accepted

# Context
Unhandled errors leaked stacks to clients in some services; others swallowed errors with 200s. Logging was noisy and uncorrelated, slowing incident response.

# Decision
Standardize a shared error boundary that always emits Problem+JSON, sets status (default 500), includes requestId, and posts a compact error event to LogSvc (FS fallback). In dev/test, also log via pino; in prod, keep responses quiet and logs structured.

# Consequences
✅ Uniform, safe errors; ✅ faster forensics via correlated logs; ⚠️ need to remove local one-off handlers; ⚠️ ensure no blocking on log emission.

# Alternatives Considered
1) Ad hoc try/catch per route (brittle). 2) Framework defaults (inconsistent). 3) Return verbose stacks (security risk). Rejected.

# References
- SOP: docs/architecture/backend/SOP.md\n- Design: docs/design/backend/errors/problem-json.md\n- Code: backend/services/shared/middleware/problemJson.ts
