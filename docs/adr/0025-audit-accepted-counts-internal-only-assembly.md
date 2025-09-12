---
id: 0025
title: Audit accepted counts & internal-only assembly
date: 2025-09-12
status: Accepted
deciders: [Platform Team]
tags: [audit, observability, s2s, internal-only]
---

# Status
Accepted

# Context
Audit previously returned {ok,received} on ingest and did not uniformly enforce S2S before parsers. Tests and ops need truthful accepted counts and strict internal-only assembly order.

# Decision
Handlers return 202 with {accepted} where 'accepted' reflects receipt at the WAL boundary (batch length). Middleware order fixed to: requestId→httpLogger→problemJson→trace5xx(early)→health→verifyS2S→parsers→routes→404→error.

# Consequences
Gateway WAL metrics and dashboards align with service responses; unauthorized calls are rejected early without parsing.

# Alternatives Considered
Compute {accepted} from DB bulkWrite (not aligned with WAL-first semantics); leave routes open (security risk).

# References
- SOP: docs/architecture/backend/SOP.md
