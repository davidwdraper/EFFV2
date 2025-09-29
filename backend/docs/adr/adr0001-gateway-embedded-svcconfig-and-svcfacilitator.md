PATH: docs/adr/adr0001-gateway-embedded-svcconfig-and-svcfacilitator.md
Title

Gateway-Embedded SvcConfig + Separate svcFacilitator for JWKS & Resolution

Status

Proposed — 2025-09-29

Context

Prior design used a standalone svcconfig service to serve service locations and security metadata. It introduced boot-order coupling, extra I/O, and “who watches the watcher” failure modes.

We need a simpler, object-oriented backbone with one public edge (Gateway), a unified S2S language, and centralized JWT/JWKS handling that’s easy to reason about and test piecemeal.

Greenfield refactor: we will not maintain backward compatibility. We’ll keep only valuable snippets, now encapsulated behind classes.

Decision

Gateway owns SvcConfig as a TypeScript class (authoritative in-process “hot” config).

Gateway persists & hot-reloads SvcConfig (DB of record may be Mongo; exact store is an implementation detail hidden by the class).

On config updates, Gateway pushes a mirror to svcFacilitator.

Introduce svcFacilitator as a separate internal service (single responsibility):

Hosts JWKS (public key set) and any shared infra endpoints needed by internal services.

Provides slug→URL resolution API (based on the mirrored config Gateway sent).

Is not business-aware; it’s pure plumbing.

Shared OO backbone (design-first):

Bootstrap (service app bootstrapping),

ServiceCaller (outbound S2S with uniform headers/envelope, URL resolution via svcFacilitator, JWT mint via Jwt→CryptoFactory→KMS),

ServiceReceiver (inbound S2S guard: request shaping + JWT validation via svcFacilitator JWKS).

Uniform S2S contract (no exceptions):

Required headers: authorization, x-request-id, x-service-name, x-api-version.

Body envelope: { meta: MessageContext, data: <payload> }.

Errors: RFC-7807 (problem+json).

Rollout: shared first (contracts + classes), then Gateway (embedded SvcConfig + mirror push), then svcFacilitator, then services one by one.

Consequences

Pros

Removes a network hop on the hot path (Gateway owns SvcConfig).

Clear separation of concerns: config authority vs. infra distributor (JWKS, resolution).

Stronger testability: each class is small, mockable, and has a single reason to change.

Faster cold start and simpler failure semantics.

Standardized S2S language reduces churn across services.

Cons / Risks

Gateway becomes stateful regarding SvcConfig (we must harden hot-reload & persistence).

svcFacilitator depends on Gateway to receive the mirror; needs retry/backoff & versioning.

Key management mistakes will centralize impact—must lock down KMS/keys and health checks.

Implementation Notes

Gateway.SvcConfig class

Public API: load(), get(slug, version), subscribe(onChange), serializeMirror().

Private: backing store I/O, diffing, validation.

On change, triggers mirror push: svcFacilitator.applyMirror(mirror, version).

svcFacilitator

Endpoints:

POST /api/facilitator/config/mirror (idempotent apply; versioned).

GET /api/facilitator/resolve/:slug?v=1 → { baseUrl, routes? }.

GET /.well-known/jwks.json → JWKS.

GET /health/live|ready.

Stores the latest mirror in its own persistence (read-through cache on boot).

JWT & KMS

Jwt uses CryptoFactory to obtain a signer/verifier.

By default, Gateway signs S2S via KMS (ES256) and rotates via svcFacilitator/JWKS distribution.

ServiceReceiver validates tokens by fetching JWKS from svcFacilitator (with caching + kid pinning).

Contracts (shared, canonical):

headers.ts: types for required headers.

envelope.ts: MessageContext, Envelope<T>.

problems.ts: helpers for RFC-7807.

slugs.ts: Slug, Version, ResolvedService.

Operational invariants

Gateway must refuse to start if SvcConfig cannot be loaded and no LKG exists.

svcFacilitator must refuse to serve stale mirrors without an explicit “stale-ok” flag (used only in dev).

All protected routes must pass through ServiceReceiver.

Alternatives Considered

Keep standalone svcconfig as the authority and consumer → rejected for complexity & boot coupling.

Push everything into Gateway (no facilitator) → rejected: key distribution & infra APIs deserve their own blast radius and scale pattern.

References

SOP: NowVibin Backend — Core SOP (Reduced, Clean)

ADR: 0030 (gateway-only KMS signing and JWKS) — superseded by this ADR if conflicts arise.

RFC-7807, JOSE/JWT specs.

Class Design (High-Level)

1. Shared Contracts (strict Zod or TS types, your call)

MessageContext: { requestId: string; caller: string; ts: string; trace?: string[] }

Envelope<T>: { meta: MessageContext; data: T }

RequiredHeaders: { authorization: string; 'x-request-id': string; 'x-service-name': string; 'x-api-version': string }

Slug, Version = number, ResolvedService = { slug: Slug; baseUrl: string; routes?: Record<string,string> }

2. Crypto & JWT

interface CryptoSigner { sign(payload: object, kid?: string): Promise<string> }

interface CryptoVerifier { verify(jwt: string): Promise<object> }

class CryptoFactory { static forKMS(): { signer: CryptoSigner; verifier: CryptoVerifier } }

class Jwt { constructor(private signer: CryptoSigner) {} mint(claims: JwtClaims): Promise<string> }

class JwksVerifier implements CryptoVerifier { constructor(jwksUri: string) {} verify(jwt: string): Promise<object> }

3. ServiceCaller (Outbound S2S)

Public:

constructor(opts: { facilitatorBase: string; serviceName: string; apiVersion: string; jwt: Jwt })

async call<TReq, TRes>(slug: Slug, version: Version, route: string, body: TReq, ctx: MessageContext): Promise<TRes>

Behavior:

Resolve baseUrl via GET /facilitator/resolve/:slug?v=….

Jwt.mint() → Authorization: Bearer …

Attach required headers + envelope.

Strict timeouts, retries, idempotency keys for POST when applicable.

4. ServiceReceiver (Inbound S2S)

Public:

middleware(): express.Middleware (validates headers, envelope; verifies JWT via svcFacilitator JWKS)

Behavior:

Fetch/caches JWKS from /.well-known/jwks.json.

Validates aud, iss, exp, kid; maps failures to RFC-7807.

Normalizes req.body into Envelope<T>; rejects nonconforming payloads.

Your item “9) ServiceReceiver.receive() calls the svcFacilitator’s jwks endpoint to validate a JWT.” → handled here: the middleware uses JwksVerifier pointed at svcFacilitator’s JWKS URL.

5. Bootstrap

Public:

async initApp({ serviceName, apiVersion, deps }: BootstrapOpts): Promise<express.Application>

Behavior:

Loads env, logging, ServiceReceiver on protected routes, health endpoints with requestId echo.

Fails fast if required deps aren’t resolvable.

6. Gateway.SvcConfig (Embedded Authority)

Public:

async load(): Promise<void>

get(slug: Slug, version: Version): ResolvedService | undefined

subscribe(onChange: (mirror: Mirror) => void): Unsubscribe

serializeMirror(): Mirror

Private:

Persistence I/O (Mongo or FS LKG), validation, diff engine.

Push mirror: Gateway posts to svcFacilitator on change.

7. svcFacilitator (Infra Service)

Applies mirror (versioned), serves resolve, exposes JWKS (rotated via its own KMS integration or fed by Gateway—TBD; recommend Facilitator is the JWKS authority so receivers have one URL).

Request/Response Shape (Canonical)

Headers (all outbound via ServiceCaller):

authorization: Bearer <jwt>
x-request-id: <uuid>
x-service-name: <caller-service-slug>
x-api-version: v1
content-type: application/json

Body envelope:

{
"meta": {
"requestId": "…",
"caller": "gateway",
"ts": "2025-09-29T17:00:00.000Z",
"trace": ["gateway:routeX","svcA:controllerY"]
},
"data": { /_ payload _/ }
}

Errors:
application/problem+json (RFC-7807) with type, title, status, detail, instance.

Sequence (Happy Path)

Gateway boot → SvcConfig.load()

Gateway pushes mirror → POST facilitator/config/mirror (ack version N)

Caller in Service A → ServiceCaller.call('user',1,'/health/live',data,ctx)

Caller resolves URL → GET facilitator/resolve/user?v=1 → { baseUrl }

Caller mints JWT (Jwt→CryptoFactory→KMS) → sends request with envelope

Receiver (User svc) middleware → fetch/cached JWKS from Facilitator → verify JWT → hand to controller

Response envelope back to caller

Rollout Plan (Methodical, no regressions)

Approve ADR.

Shared package: add contracts (headers, envelope, problems), CryptoFactory, Jwt, ServiceCaller/ServiceReceiver interfaces (no impl yet).

Gateway: implement SvcConfig class + boot fast-fail + mirror push.

svcFacilitator: minimal service with mirror endpoint, resolve, JWKS.

Implement Jwt/CryptoFactory with KMS + Facilitator JWKS.

Convert one target service (e.g., user) to ServiceReceiver guard + use ServiceCaller for any outbound.

Smoke per service, then iterate.

Reality check / blunt bits

Yes, this will finally stop the “regress everything” merry-go-round. Each unit is a brick, not wet clay.

Gateway holding SvcConfig is opinionated—but it’s simpler, faster, and puts responsibility where it belongs.

svcFacilitator must be boring and rock solid. If it’s “interesting,” we did it wrong.

If this ADR looks good, say the word and I’ll drop the interfaces-only (no bodies) for:

shared/contracts (headers, envelope, problems, slugs)

shared/crypto (CryptoFactory, CryptoSigner, CryptoVerifier, Jwt)

shared/s2s (ServiceCaller, ServiceReceiver)

gateway/src/svcconfig/SvcConfig (class shape only)

svc-facilitator route stubs & OpenAPI skeleton

No code bodies until the ADR is accepted.
