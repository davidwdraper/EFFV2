---
id: 0024
title: Extract readiness from app assembly for separation-of-concerns
date: 2025-09-11
status: Accepted
tags: [architecture, gateway]
---

# Status
Accepted

# Context
readiness logic lived inside app assembly, making testing harder and violating single-concern files per SOP.

# Decision
Move readiness into src/readiness.ts and import into app.ts. Drive required upstreams via GATEWAY_REQUIRED_UPSTREAMS.

# Consequences
Cleaner assembly, targeted tests, easier env overrides; no behavior change to health endpoints.

# Alternatives Considered
(fill in: considered options & tradeoffs)

# References
- SOP: docs/architecture/backend/SOP.md
