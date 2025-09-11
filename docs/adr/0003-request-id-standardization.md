---
id: 0003
title: Request ID standardization
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [observability, trace, audit, telemetry]
---

# Status
Accepted

# Context
Distributed logs, guardrail denials, and audit WAL events must correlate across gateway, core, and workers. Prior ad-hoc request ID handling caused missing/duplicated IDs, making incident forensics and billing audits slow and error-prone.

# Decision
Adopt a shared middleware that (1) accepts x-request-id/x-correlation-id/x-amzn-trace-id, (2) generates UUIDv4 when absent, (3) writes req.id for in-process use, and (4) always echoes x-request-id on responses. Mount it first (before logging, guardrails, and audit) in createServiceApp().

# Consequences
✅ End-to-end traceability; ✅ simpler multi-hop debugging; ✅ consistent log queries; ⚠️ need CI/lint to enforce early mount; ⚠️ downstream services must avoid re-minting conflicting IDs.

# Alternatives Considered
1) Per-service conventions (drift, inconsistent headers). 2) Exclusive reliance on vendor tracing headers (lock-in, partial coverage). 3) Do nothing (poor auditability). Rejected.

# References
- SOP: docs/architecture/backend/SOP.md\n- Design: docs/design/backend/app/requestId.md\n- Code: backend/services/shared/middleware/requestId.ts
