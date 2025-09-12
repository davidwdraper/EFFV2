---
id: 0023
title: Use jose for gateway user assertion minting (HS256)
date: 2025-09-11
status: Accepted
tags: [security, auth]
---

# Status
Accepted

# Context
Gateway must mint short-lived user assertions. jsonwebtoken added API inconsistency and duplicate crypto stacks.

# Decision
Use jose SignJWT (HS256) with USER_ASSERTION_SECRET/ISSUER/AUDIENCE envs. Unify on jose across services.

# Consequences
Fewer deps, consistent JWT handling. Requires async minting; trivial callsite changes.

# Alternatives Considered
(fill in: considered options & tradeoffs)

# References
- ADR-0014 S2S JWT; - SOP: docs/architecture/backend/SOP.md
