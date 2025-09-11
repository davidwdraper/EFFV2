---
id: 0004
title: HTTP telemetry with pino-http
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [observability, logging, telemetry, pino]
---

# Status
Accepted

# Context
We need uniform, structured HTTP request logs across all services to observe traffic, latency, and errors. Prior services used mixed loggers/levels and leaked noisy endpoints, making SLOs and incident analysis unreliable.

# Decision
Standardize on pino-http in a shared middleware mounted immediately after requestId. Bind a child logger with {service}, reuse req.id (or recover from headers/UUID), map severities (2xx/3xx=info, 4xx=warn, 5xx|err=error), ignore health/favicons, and keep serializers lean (method, url, status, reqId). Keep telemetry separate from SECURITY and WAL.

# Consequences
✅ Consistent, low-overhead logs; ✅ easy aggregation by service/reqId; ✅ clearer severity signals; ⚠️ must prevent scope-creep (no business data in access logs); ⚠️ header/body redaction policy to be expanded.

# Alternatives Considered
1) Custom per-service logging (drift). 2) Heavier APM auto-instrumentation (cost/opacity). 3) No access logging (blind ops). Rejected.

# References
- SOP: docs/architecture/backend/SOP.md\n- Design: docs/design/backend/observability/http-logging.md\n- Code: backend/services/shared/middleware/httpLogger.ts
