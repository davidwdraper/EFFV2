---
id: 0032
title: Route Policy via svcconfig + E2E Context Token and Ephemeral Per-Hop S2S
date: 2025-09-26
status: Proposed
deciders: [David Draper]
tags: [security,  auth,  svcconfig,  gateway,  s2s,  kms,  tokens,  policy]
---

# Status
Proposed

# Context
We’re building a ground-up backend where the edge gateway is the sole public entry point, and internal worker services are called via a shared callBySlug() function. We recently switched to Google KMS and public/private keys for minting service-to-service (S2S) JWTs.

Problem forces:
- Some routes must be callable anonymously (e.g., account creation, login, password-reset initiation).
- Other routes must require a user assertion (client JWT) or explicitly forbid it.
- We want a central source of truth for per-route access policy, owned by svcconfig, keyed by {slug, version} with one record per service/version.
- The gateway already loads and caches svcconfig. If a route has no policy, the request must fail closed with loud logging.
- We want to avoid per-hop KMS latency when services call other services via callBySlug(), while keeping strict audience-exact verification and least privilege.

Non-goals:
- No production backward compatibility constraints (pure dev).
- No leaking client JWTs downstream of the edge.

# Decision
Adopt a versioned Route Access Policy in svcconfig (default-deny) and enforce it at the gateway with optional re-enforcement at workers. Introduce a two-token model to preserve strict security without per-hop KMS cost:

1) Route Access Policy (per {slug, version})
   - Rule fields: method, path (normalized; tokens like :id), public: bool, userAssertion: required | optional | forbidden, opId.
   - defaults: { public: false, userAssertion: required } for defense-in-depth.
   - Precedence: first-match wins; exact > parametric > wildcard. Unknown/ambiguous → reject at load.

2) Gateway Enforcement (edge)
   - Load/cache policy; deny on miss (fail closed).
   - Enforce public and userAssertion:
     • required: validate client JWT at edge; otherwise 401/403.
     • forbidden: strip any client Authorization; otherwise 403.
     • optional: pass if present/valid; OK if absent.
   - Never forward the raw client JWT.
   - Always call workers using shared callBySlug().

3) Two-Token Model (fast + safe)
   - CTX (Context Token) — minted once at the edge per request. Carries rid (requestId), hop budget, deadline, and optional act (user projection) derived from a validated client JWT. Signed by the edge’s Ephemeral Signing Key (ESK). CTX conveys context, not capability.
   - HOP (Per-Hop S2S Token) — minted at each hop by callBySlug() using the ESK private key (in-memory). Very short TTL (~60–120s), strict aud = target slug, includes minimal act only when policy allows (required/optional). HOP conveys capability for the specific hop.

4) KMS + ESK (latency-aware)
   - Use KMS to sign an ESK certificate periodically (e.g., every 15m).
   - Publish ESK public key(s) (current + previous) on JWKS from the gateway, with the KMS-signed certificate to bind trust.
   - All CTX and HOP tokens are signed with the current ESK, avoiding per-hop KMS calls while preserving a KMS root of trust.

5) Workers
   - Always verify HOP (iss allowed, aud = this slug, TTL/skew).
   - Recommended: consult the same policy to re-enforce userAssertion semantics (required/optional/forbidden) vs act presence; otherwise run observe-only and flip to enforce later.
   - When calling downstream, callBySlug() mints a fresh HOP and:
     • Copies act from CTX only when downstream policy allows.
     • Drops act when downstream policy forbids.
     • Never originates act (only the edge can).

6) Defaults & Examples
   - Default posture: public=false, userAssertion=required.
   - Auth examples (v1):
     • PUT /v1/users → public:true, userAssertion:forbidden (account creation).
     • POST /v1/login → public:true, forbidden.
     • POST /v1/password_reset → public:true, forbidden.
     • DELETE /v1/users/:id → public:false, required.
   - This unblocks Smoke-23 (user create) without weakening other flows.

7) Observability & Audit
   - Decision logs (edge/workers): slug, version, opId, public, userAssertion, decision, policyRevision, rid, act_present, hop.
   - WAL on mutations includes opId, authMode: anon|user|s2s, uid?, and policyRevision.

Token TTLs & budgets:
- ESK rotation: 15m with 5m overlap.
- HOP TTL: ~90s (respect S2S_CLOCK_SKEW_SEC).
- CTX TTL: request budget (≤10–15s).
- hop_max: 4 (deny on overflow).

Answer to “reuse first S2S across hops?” — Do not reuse: audience-exact verification breaks on the next hop, or forces multi-aud tokens (rejected). CTX+HOP keeps strong aud while avoiding per-hop KMS latency.

# Consequences
Pros:
- Central, versioned policy in svcconfig; default-deny reduces accidental exposure.
- Strict audience-per-hop with short-lived HOP tokens; no per-hop KMS latency.
- Clean audit trail: iss→aud chains, opId, policyRevision, rid, act_present.
- Clear separation: CTX (context) vs HOP (capability); client JWT never leaves edge.

Tradeoffs:
- Slight complexity: CTX + HOP + ESK rotation and cache management.
- Requires consistent path normalization and rule linting to avoid overlaps.
- Policy availability becomes a dependency; mitigated with cache + fail-closed.

Operational impacts:
- Need JWKS exposure for ESK keys (current/previous) and KMS-signed cert chain.
- Health endpoints should report policyRevision and JWKS/ESK status for smoke tests.
- Introduce observe-only mode for policy enforcement to de-risk rollout.

# Alternatives Considered
1) Reuse the first S2S token across downstream hops — Rejected.
   Breaks strict aud or forces multiple audiences; widens blast radius and complicates revocation/observability.

2) Per-hop KMS signing — Rejected for latency.
   Secure but too slow under fan-out; adds cost and tail-latency variability.

3) Multi-audience tokens — Rejected.
   Leaks topology, widens capability, and weakens verification semantics.

4) Gateway-only enforcement (workers trust edge) — Deferred/limited.
   Simpler but fragile; prefer optional worker re-enforcement (observe→enforce) for zero-trust.

5) Embed raw client JWT downstream — Rejected.
   Expands attack surface and couples internal services to edge auth semantics.

# References
- SOP: docs/architecture/backend/SOP.md
- Logging & Audit SOP: docs/architecture/backend/LOGGING_AUDIT.md
- Health/Readiness ADRs: docs/adr/0016-standard-health-and-readiness-endpoints.md
- ADR-0030: gateway-only KMS signing and JWKS
- svcconfig Service Overview: docs/architecture/backend/svcconfig/OVERVIEW.md
