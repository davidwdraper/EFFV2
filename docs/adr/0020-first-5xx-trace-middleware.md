---
id: 0020
title: First 5xx trace middleware
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [observability, debugging, telemetry]
---

# Status
Accepted

# Context
5xx status codes were set at multiple layers, obscuring root cause. Full stacks are noisy and costly to ship.

# Decision
Adopt a shared trace5xx middleware that captures and logs the first 5xx assignment with a compact, repo-local stack and a stable sentinel <<<500DBG>>>.

# Consequences
✅ Faster triage; ✅ minimal overhead; ⚠️ relies on V8 stack shapes (covered by tests); ⚠️ mount early (and optionally late).

# Alternatives Considered
1) Full stack logging (noisy/costly). 2) APM-only traces (opaque). 3) Do nothing (slow MTTR). Rejected.

# References
- Design: docs/design/backend/observability/trace5xx.md\n- Code: backend/services/shared/middleware/trace5xx.ts
