---
id: 0014
title: S2S JWT verification for internal services
date: 2025-09-10
status: Accepted
deciders: [Platform Team]
tags: [security, auth, s2s, jwt, jwks]
---

# Status
Accepted

# Context
Internal services need consistent, secure S2S verification. Prior ad hoc verifiers varied in algorithms, issuers, and audiences, complicating rotation and audits.

# Decision
Use a shared verifyS2S middleware: RS256 via JWKS in production with ETag caching and rotation-friendly multiple kids; HS256 allowed only in development. Enforce audience and allowed issuers; authorize by custom 'svc' claim against S2S_ALLOWED_CALLERS. Health routes are public; all others require S2S.

# Consequences
✅ Uniform S2S security; ✅ safe key rotation; ✅ simple ops; ⚠️ requires reliable JWKS endpoint; ⚠️ misconfig should fail loudly.

# Alternatives Considered
1) Per-service custom checks (drift). 2) Mesh-only policy (lock-in). 3) Skip S2S verification (unacceptable).

# References
- SOP: docs/architecture/backend/SOP.md\n- Addendum 2 — Security & S2S Authorization\n- Code: backend/services/shared/middleware/verifyS2S.ts
