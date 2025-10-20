adr0035-jwks-gcp-kms-ttl-cache

# ADR-0035 — JWKS via Google Cloud KMS with TTL Cache

## Context

We now have `/api/jwks/v1/keys` green with a temporary policy. Time to replace the mock key source with **real asymmetric keys in Google Cloud KMS** and add a **configurable TTL cache** so the JWKS endpoint is fast and stable.

Constraints & invariants (per SOP):

- **Environment invariance:** no literals or fallbacks; fail-fast if required envs are missing.
- **Single envelope on responses;** requests are flat bodies (unchanged).
- **Dev ≈ Prod:** only env values differ.
- **Single-concern classes;** DI for wiring.
- **Health first; security after health.**
- **No compatibility branches.** We break then fix.

Operational goals:

- Publish a stable **JWKS (RFC 7517)** containing **one or more public keys** for our signing keys.
- Keys are **created and stored in KMS** as asymmetric signing keys. We **never export private keys.**
- The JWKS **must be cached** in-memory with a small TTL to avoid hammering KMS and to keep p50 latency tiny.
- The cache must **evict on TTL** and refresh on demand; **no background pollers** in v1.

## Decision

1. **Key Source = Google Cloud KMS**
   - Use asymmetric key(s) under:
     - `KMS_PROJECT_ID`
     - `KMS_LOCATION_ID`
     - `KMS_KEY_RING_ID`
     - `KMS_KEY_ID` (logical key, multiple versions allowed)
     - `KMS_KEY_VERSION` (explicit version to serve; v1 requires explicitness to be deterministic)
   - Public key retrieval via KMS API. We convert PEM → JWK (RSA or EC) including **`kid`**, **`kty`**, **`alg`**, **`use`="sig"**, and key params.

2. **Explicit `kid` Strategy**
   - `kid` = `<project>:<location>:<ring>:<key>:<version>`.
   - Deterministic, globally unique, human-auditable.
   - Caller caches/verifies by `kid`.

3. **TTL Cache (in-memory)**
   - `NV_JWKS_CACHE_TTL_MS` (required). Example: `60000`.
   - On first request or stale cache, **fetch → convert → store**:
     - `{ jwks, expiresAtMillis }`.
   - Concurrent thundering-herd guard: single in-flight refresh promise; subsequent callers await it.
   - If refresh fails and there is **no warm cache**, **fail the request** (HTTP 503 via `problem.ts`). No silent fallbacks.

4. **Wiring & Interfaces**
   - `IJwksProvider` (single concern): `getJwks(): Promise<{ keys: Jwk[] }>`
   - `KmsJwksProvider` implements `IJwksProvider`.
   - `JwksCache` (small class) owns TTL + in-flight guard.
   - `JwksEnv.assert()` validates required envs at **boot** (fail-fast).
   - Route handler depends on `IJwksProvider` via DI (no factories reading envs).

5. **Algorithms**
   - **RSA**: read PEM, parse modulus/exponent → base64url encode → `n`, `e`, `kty="RSA"`, `alg="RS256"` (or from env `KMS_JWT_ALG`).
   - **EC** (if used later): parse curve → `crv`/`x`/`y` → `kty="EC"`, `alg="ES256" | ES384`.
   - `use="sig"` for all keys.

6. **Security Posture**
   - Service account credentials via **ADC** or `GOOGLE_APPLICATION_CREDENTIALS`. No secrets in repo.
   - JWKS endpoint remains **public route** (policy: `public=true` in facilitator), service itself `internalOnly=true`.
   - No private material leaves KMS.

## Consequences

**Pros**
- Production-grade key custody (no app-managed private keys).
- Predictable latency thanks to TTL cache.
- Clean separation: env validation at boot, KMS I/O isolated, caching isolated, route thin.

**Cons**
- First hit after TTL may incur KMS latency.
- Requires careful PEM→JWK conversion and future EC support (non-breaking).

**Risk Mitigations**
- In-flight refresh guard prevents stampedes.
- Clear errors via `problem.ts` if KMS unavailable and cache empty (surface it; do not lie).

## Implementation Notes

**Env (all required; no defaults):**
- `KMS_PROJECT_ID`
- `KMS_LOCATION_ID`
- `KMS_KEY_RING_ID`
- `KMS_KEY_ID`
- `KMS_KEY_VERSION`  ← v1 design requires explicit version
- `NV_JWKS_CACHE_TTL_MS` (integer > 0)
- `KMS_JWT_ALG` (one of `RS256`, `RS384`, `RS512`, `ES256`, `ES384`) — required to avoid guessing

**New files (one-concern each):**
- `backend/services/jwks/src/env/JwksEnv.ts` (update): strict Zod schema for all envs above.
- `backend/services/jwks/src/jwks/IJwksProvider.ts`: interface only.
- `backend/services/jwks/src/jwks/JwksCache.ts`: TTL cache + in-flight guard.
- `backend/services/jwks/src/jwks/KmsJwksProvider.ts`: KMS calls + PEM→JWK conversion + `kid`.
- `backend/services/jwks/src/routes/jwks.routes.ts`: unchanged shape; resolves provider via DI and returns `{ keys: [...] }`.

**DI (example, not code here):**
- `app.ts` wires:
  - `const env = JwksEnv.assert();`
  - `const cache = new JwksCache(env.NV_JWKS_CACHE_TTL_MS);`
  - `const provider = new KmsJwksProvider(env, cache);`
  - Mount health, then `/keys` route (public policy in facilitator).

**Testing (smoke):**
- `018-jwks-health-via-gateway.sh` (already green).
- `019-jwks-keys-kid.sh`: assert presence of `kid` matching `<project>:<location>:<ring>:<key>:<version>`.
- `020-jwks-cache-ttl.sh`: call `/keys`, sleep `<ttl/2>`, call again (should *not* hit KMS); then sleep past TTL, call (should refresh once).

**Observability:**
- Log on refresh start/end with `x-request-id`.
- Log `kid` and `alg` (no key material).
- Count refreshes; warn if refresh < TTL/4 (callers hammering? reduce TTL/raise?).

## Alternatives Considered

- **App-local keypair** (rejected): breaks custody and rotation story.
- **JWKS file in object storage** (rejected for v1): adds storage dependency and rotation path; KMS direct is simpler.
- **Background refresher** (defer): v1 uses on-demand refresh with in-flight guard; simpler and sufficient.

## References

- SOP Reduced/Clean
- ADR-0017 — JWKS Service carve-out (policy)
- Google Cloud KMS — GetPublicKey (asymmetric)
- RFC 7517 (JWK), RFC 7518 (JWA), RFC 7519 (JWT)
