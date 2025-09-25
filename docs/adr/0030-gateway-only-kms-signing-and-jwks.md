---
id: 0030
title: Gateway-only KMS signing and JWKS
date: 2025-09-24
status: Accepted
deciders: [David Draper, Core Backend Team]
tags: [security, auth, kms, jwks, gateway]
---

# Status
Accepted

# Context
We are eliminating shared-secret (HS256/HMAC) signing for S2S tokens. The public edge (gateway) will sign S2S JWTs using a Google Cloud KMS asymmetric key. Downstream internal services verify via JWKS exposed by the gateway. This centralizes key custody, enables rotation/versioning, removes secret sprawl, and provides provenance. Constraints: low-latency mint/verify, bounded failure modes, cacheable JWKS, dev/stage/prod parity.

# Decision
- Gateway mints S2S JWTs with a KMS-managed asymmetric key (RS256 or ES256).
- Gateway exposes a stable JWKS endpoint (/.well-known/jwks.json) containing current ENABLED key versions.
- All worker services verify S2S via jose jwtVerify + Remote JWKS; required claims: iss, aud, exp, iat, jti.
- Required envs: S2S_JWKS_URL, S2S_JWT_AUDIENCE, S2S_ALLOWED_ISSUERS; optional: S2S_JWKS_TIMEOUT_MS, S2S_JWKS_COOLDOWN_MS, S2S_CLOCK_SKEW_SEC.
- No HS256 anywhere. No open-bypass flags.

# Consequences
+ Stronger security posture; rotation without redeploy; auditable provenance via KMS key version.
+ Single verification path across services; simpler code and reviews.
- Added network call on first verify per kid; mitigated via JWKS caching/cooldown.
- Requires KMS availability and correct gateway JWKS publishing; add readiness checks and smoke tests.

# Alternatives Considered
A) Keep HS256 as fallback — rejected (weakens guarantees, increases drift).
B) Self-host HSM — rejected (ops cost, no added value right now).
C) Each service signs its own tokens — rejected (key sprawl, harder rotation).

# References
- SOP: docs/architecture/backend/SOP.md
- Google Cloud KMS docs
- JOSE / JWKS RFC 7517, JWT RFC 7519
