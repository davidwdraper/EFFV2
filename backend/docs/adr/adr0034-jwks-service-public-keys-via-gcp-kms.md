# adr0034-jwks-service-public-keys-via-gcp-kms

# ADR-0034 — JWKS Service via GCP KMS, Discovered by SvcFacilitator (internalOnly=true)

## Context
- We need a dedicated microservice whose single responsibility is to expose **JSON Web Key Sets (JWKS)** for verification of NV-minted JWTs.
- **Service discovery and policy must flow through `svcfacilitator`**, like every other worker. The `jwks` service will have a **slug entry in `svcconfig`** with **`internalOnly=true`**.
- The **public keys endpoint** is reachable **only through the Gateway**, which enforces our standard edge posture. JWKS by nature is public material; S2S tokens add no value for this specific read-only route.
- To adhere to the **frozen plumbing** and still allow a public route, we will add an explicit **bypass toggle** in both **`SvcClient`** and **`SvcReceiver`** that can disable token minting/verification **per-call / per-route**. No hidden defaults; opt-in only.
- Contracts-first still applies: we ship a `jwks.contract` in shared that defines the exact JWK Set shape we emit (subset of RFC 7517 we support).

## Decision
- Create a separate service **`jwks`** following the standard template (AppBase → SvcReceiver → Routers → Controllers).
- Register **`jwks@v1`** in **`svcconfig`** via `svcfacilitator` with **`internalOnly=true`**. Discovery and route policy live in facilitator as usual.
- Expose two routes (versioned), both **resolved via facilitator** and **served through the Gateway**:
  - `GET /api/jwks/v1/health` — standard NV health route (public).
  - `GET /api/jwks/v1/keys` — returns **raw JWKS** (`{ "keys": [...] }`) per RFC 7517 (no NV envelope on this route, by design for interoperability).
- **Security**:
  - Add an explicit, audited bypass in **`SvcReceiver`** for the `/keys` route to **skip S2S verification**. This is **opt-in and route-scoped** (no global switch).
  - Add a mirrored **bypass in `SvcClient`** to **skip token minting** when the Gateway calls `/keys`. Again, explicit and call-scoped.
  - Facilitator **RoutePolicy** marks `/api/jwks/v1/keys` **public=true** to document the intent.
- **Provider**: Primary implementation uses **Google Cloud KMS** for asymmetric key pairs. Keys are converted to JWKs; `kid` is deterministic and strategy-driven.
- **Caching**: In-memory cache of the assembled JWK Set with TTL from env. On provider error, respond 5xx; no stale-by-default.

## Consequences
**Pros**
- Full adherence to **standard plumbing** (discovery, policy, routing) while still delivering a standards-compliant public JWKS.
- No special-cased infrastructure outside NV’s normal path; the **only exception** is the **intentional auth bypass** for a single public route, controlled by code and policy.
- Future providers (HSMs) can be added behind the same interface.

**Cons**
- Requires adding explicit bypass knobs to SvcClient/SvcReceiver—care must be taken to scope and audit usage so we don’t create foot-guns.
- Another service to deploy/monitor (acceptable for single-concern purity).

## Implementation Notes
**Contracts**
1. `backend/services/shared/src/contracts/security/jwks.contract.ts`
   - `Jwk` + `JwkSet` Zod schemas (export types). Validate the exact shape we publish.

**Security Bypass (explicit, audited)**
- `SvcClient.callBySlug(..., { security: "none" })` (name illustrative) — skips token mint.
- `SvcReceiver` route option `{ security: "none" }` for `/keys` — skips verification middleware.
- Bypass points MUST log a **SECURITY category info** with route + requestId to make this visible in logs.

**Provider & Factory**
- `IJwksProvider#getJwks(): Promise<JwkSet>`
- `GcpKmsJwksProvider` obtains public keys, normalizes to JWK (RSA/ECDSA), computes `kid` via strategy.
- `JwksProviderFactory` selects provider from env — **fail-fast** if invalid.

**Routes**
- `/api/jwks/v1/keys` — returns **raw** JWKS (no envelope). This exception is documented here and enforced only on this route.
- `/api/jwks/v1/health` — standard health.

**Env (all required; no defaults)**
- `NV_JWKS_PROVIDER=gcp-kms`
- `NV_GCP_PROJECT`
- `NV_GCP_LOCATION`
- `NV_GCP_KMS_KEYRING`
- `NV_GCP_KMS_KEYS` (comma-separated resource paths or logical names—documented format)
- `NV_JWKS_KID_STRATEGY` (e.g., `sha256-modulus` or `gcp-resource-hash`)
- `NV_JWKS_CACHE_TTL_MS`

**Kid Strategy**
- Deterministic per key version. Rotation produces a new `kid`. Consumers must refresh on signature failure.

**Policy**
- Facilitator RoutePolicy: `GET /api/jwks/v1/keys` → `public=true`.
- Service `internalOnly=true` in svcconfig ensures it is never exposed directly without the Gateway.

## Alternatives
1) **Always require S2S** even for JWKS — rejected; no benefit and complicates third-party verifier compatibility at the edge.
2) **Static object-store JWKS** — rejected; rotation and freshness brittle.
3) **Fold into facilitator** — rejected; mixes concerns and increases blast radius of core config service.

## References
- RFC 7517 (JWK), RFC 7518 (JWA)
- Google Cloud KMS: asymmetric keys & public key retrieval
- NV SOP & Addenda (Environment Invariance; Single-Concern; Frozen Plumbing)
