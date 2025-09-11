---
id: 0002
title: Request ID standardization
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [observability, trace, audit]
---

# Status
Accepted

# Context
Logs, guardrail denials, and audit WAL need a common correlation key across gateway, core, and workers.

# Decision
Adopt shared middleware that accepts x-request-id/x-correlation-id/x-amzn-trace-id, generates UUIDv4 if missing, sets req.id, and echoes x-request-id on responses. Mount before logging/guards/audit globally.

# Consequences
Traceable multi-hop requests; simpler incident forensics; must ensure all services mount early; requires CI/lint to catch local deviations.

# Alternatives Considered
Ad-hoc per-service conventions; third-party tracing headers only; do nothing. Rejected due to inconsistency and operational cost.

# References
- SOP: docs/architecture/backend/SOP.md\n- Design: docs/design/backend/app/requestId.md
