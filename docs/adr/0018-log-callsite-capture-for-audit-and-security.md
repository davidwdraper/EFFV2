---
id: 0018
title: Log callsite capture for audit and security
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [observability, logging, audit, telemetry]
---

# Status
Accepted

# Context
Operators need fast provenance for audit/security events without shipping full stack traces. Hand parsing of logs slows incident response.

# Decision
Introduce getCallerInfo() to extract a single, stable callsite (file:line:function) from the current stack, filtering node internals and node_modules. Logger enriches events with this metadata for audit and security channels.

# Consequences
✅ Quicker triage and code navigation; ✅ smaller log payloads; ⚠️ stack parsing is best-effort and format-sensitive; mitigate with unit tests in CI.

# Alternatives Considered
1) Ship full stacks (expensive/noisy). 2) No callsite (slower MTTR). 3) APM-only (opaque/costly). Rejected.

# References
- Design: docs/design/backend/observability/log-callsite-capture.md\n- Code: backend/services/shared/utils/logMeta.ts
