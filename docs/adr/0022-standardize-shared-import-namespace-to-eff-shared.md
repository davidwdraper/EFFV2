---
id: 0022
title: Standardize shared import namespace to @eff/shared
date: 2025-09-11
status: Accepted
tags: [tooling, dx, build]
---

# Status
Accepted

# Context
Mixed @shared and @eff/shared caused drift and inconsistent builds. We need a single stable alias across services to keep runtime and types aligned.

# Decision
Adopt @eff/shared/* as the sole shared import namespace across all services. tsconfig paths resolve to ../shared/dist/* to match runtime artifacts.

# Consequences
Short refactor pass; editors/indexers reload. Prevents accidental source-path imports and keeps CI/dev parity.

# Alternatives Considered
(fill in: considered options & tradeoffs)

# References
- SOP: docs/architecture/backend/SOP.md
