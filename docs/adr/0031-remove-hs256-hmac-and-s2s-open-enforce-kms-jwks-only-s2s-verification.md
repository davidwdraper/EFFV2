---
id: 0031
title: Remove HS256/HMAC and S2S_OPEN; enforce KMS/JWKS-only S2S verification
date: 2025-09-24
status: Accepted
deciders: [David Draper, Core Backend Team]
tags: [security, auth, kms, jwks, cleanup]
---

# Status
Accepted

# Context
Historically our S2S verification supported a fallback to HS256 with a shared
`S2S_JWT_SECRET` and a development flag `S2S_OPEN` that skipped checks entirely.
This was a temporary bridge while we rolled out KMS-signed asymmetric JWTs and
service configuration discovery.

Now that KMS-based signing and JWKS-based verification are fully deployed,
those legacy paths are both unnecessary and risky:
- Shared secrets are a single point of failure and cannot be rotated safely.
- The S2S_OPEN runtime bypass invites accidental production exposure.
- Carrying HS256 code complicates audits and test harnesses.

This ADR formalizes the removal of those legacy mechanisms.

# Decision
Effective immediately we will:
- Remove all code and configuration references to S2S_OPEN, S2S_JWT_SECRET,
  and HS256/HMAC verification.
- Require all S2S tokens to be signed with a KMS-managed asymmetric key
  (RS256/ES256) and verified via JWKS.
- Require explicit `S2S_JWKS_URL`, `S2S_JWT_AUDIENCE`, and
  `S2S_ALLOWED_ISSUERS` environment variables.
- Enforce verification in every service using jose/jwtVerify with a remote
  JWKS set and bounded caching/timeouts.

All deployments must have KMS keys and JWKS endpoints configured prior to
upgrading to code that implements this ADR.

# Consequences
Positive:
- Stronger security posture: no shared secrets to steal or rotate.
- Simpler code: one verification path and a smaller attack surface.
- Better auditability: all S2S tokens traceable to a KMS key version.

Negative / Risks:
- All environments (dev, test, prod) must have working KMS and JWKS; no
  temporary open mode for quick local testing.
- Service bootstraps and smoke tests must handle JWKS unavailability
  gracefully but cannot bypass verification.

Operational:
- Remove S2S_JWT_SECRET and S2S_OPEN from every .env.* file.
- Update smoke tests to expect only KMS/JWKS verification.

# Alternatives Considered
1. Keep HS256 as a fallback  
   - Pros: simpler local dev if KMS is down.  
   - Cons: undermines security guarantees; complicates code; not acceptable.

2. Keep S2S_OPEN for smoke only  
   - Pros: fast smoke tests.  
   - Cons: same risk; could leak into production by accident.

Both rejected in favor of a single KMS/JWKS-only path.

# References
- SOP: docs/architecture/backend/SOP.md
- ADR 0030: Gateway-only KMS signing and JWKS
- Google Cloud KMS documentation: https://cloud.google.com/kms/docs
