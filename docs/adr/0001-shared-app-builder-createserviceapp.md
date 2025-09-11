---
id: 0001
title: Shared app builder (createServiceApp)
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [sop, express, security, observability]
---

# Status
Accepted

# Context
Multiple services hand-wired Express with inconsistent middleware order and missing guardrails. We need a single canonical builder to enforce health-before-auth, guardrails-before-audit, and audit-before-proxy.

# Decision
Introduce a shared factory createServiceApp() that assembles: httpsOnly→cors→requestId→pino-http→problem+json→trace5xx(early)→health→guardrails(rateLimit, timeout, breaker, authGate)→audit(WAL init + capture)→proxy(injectUpstreamIdentity, serviceProxy)→routes→tails(json parser, 404, errorHandler). All services must use it.

# Consequences
Pros: consistent security posture, faster new-service spin-up, simpler audits, fewer order-of-middleware bugs. Cons: temptation to bloat shared; need CI to enforce usage; minor refactor effort per service.

# Alternatives Considered
1) Per-service assembly (drift risk). 2) Framework magic (opaque order). 3) Sidecar proxies (operational overhead). Rejected for now.

# References
- SOP: docs/architecture/backend/SOP.md\n- Design: docs/design/backend/app/createServiceApp.md
