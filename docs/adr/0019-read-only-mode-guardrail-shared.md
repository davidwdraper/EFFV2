---
id: 0019
title: Read-only mode guardrail (shared)
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [operations, guardrail, security, reliability]
---

# Status
Accepted

# Context
During incidents and maintenance we need a fast, uniform way to halt mutations without redeploying. Ad hoc toggles across services drifted and left gaps.

# Decision
Introduce a shared read-only gate middleware. When READ_ONLY_MODE=true, block mutating HTTP methods with 503 Problem+JSON and log to SECURITY with reason=read_only_mode. Allow exemptions via READ_ONLY_EXEMPT_PREFIXES and per-instance options. Re-read env each request to allow runtime flips.

# Consequences
✅ Single flip to freeze writes; ✅ consistent telemetry; ⚠️ minor overhead per request; ⚠️ teams must keep exemptions minimal.

# Alternatives Considered
1) Only gateway freeze (background jobs can still mutate). 2) Per-service toggles (drift). 3) DB-level readonly (blunt and invasive). Rejected.

# References
- Design: docs/design/backend/guardrails/read-only-mode.md\n- Code: backend/services/shared/middleware/readOnlyGate.ts
