✅ NowVibin Backend — Pocket SOP v4 (Checklist)

🔗 Routes (No Exceptions)

API: http(s)://<host><port>/api/<serverName>/<rest>

Health: http(s)://<host><port>/<healthRoute>

<serverName> = env config key.

📐 Service Pipeline (Template Clone)

Contract → Zod in shared/contracts/<entity>.contract.ts (truth)

DTOs → .pick/.omit/.partial from contract

Mappers → domainToDb, dbToDomain

Model → persistence only, indexes, bufferCommands=false

Repo → return domain objects only

Controller → validate → DTO → repo → return domain, push audits

Routes → one-liners, import handlers only

⚖️ Prime Directives

No splicing. Full file drops, repo path on line 1.

No barrels, no shims, no hacks.

Env names only.

Debug logs (enter/exit) w/ requestId.

Controllers push → req.audit[], flush once.

Global error middleware only.

📋 Session Ritual

Paste this Pocket SOP.

State service name.

Paste full files.

I return full drops, no options.

✅ Quick Checklist Before Merge

Required envs asserted

No logic in routes

RequestId logs on entry/exit

Audit flushed once

.env.test present

Tests green via gateway and direct

Coverage ≥90%

Seeds idempotent + descriptive

No barrels/shims/console logs

Authority: Long SOP v4 (Amended). This sheet = working memory.

Route Semantics — Create / Replace / Update

Non-negotiable rules for entity endpoints:

Create

Always PUT to the collection root (e.g. PUT /api/user, PUT /api/act).

No :id in the path; the service generates \_id (Mongo).

Response must include the \_id so clients/tests can chain GET/DELETE.

Mirrors our Act service contract.

Replace

PUT /api/<entity>/:id is not supported in our system.

We never PUT with a known id (Mongo owns \_id).

Any “replace” semantics happen as a PATCH-like flow (not full object replace).

Update / Patch

PATCH /api/<entity>/:id for partial updates.

Must validate against z<Entity>Patch.

Read

GET /api/<entity>/:id returns the domain object.

Delete

DELETE /api/<entity>/:id removes the entity.

DELETE must be idempotent: return 200/202/204 if deleted, 404 if already gone.

Backend Message Flow — Architecture & System Design (SOP Addendum)

no drama, just rules. paste this into the SOP and hold the line.

1. Scope & Goals

Define how requests travel across the backend:

Who talks to whom (and who never should).

Where auth is enforced and who mints tokens.

Where to put health, rate limits, timeouts, circuit breakers, logging, and audits.

Route shapes and method semantics (PUT/PATCH/DELETE).

Clear responsibilities per layer (Controller → Repo → Model).

This governs Gateway, Gateway-Core, and all Services (User, Act, Geo, etc.).

2. Actors (concise)

Gateway (4000): Internet edge. Proxies /api/<service>/<rest> directly to services. Drops inbound Authorization and mints S2S for downstream. Health passthrough to upstream /health/\* without S2S.

Gateway-Core (4011): Internal broker for service→service calls. Accepts an internal request, mints S2S, invokes target service, returns response.

Services (4xxx): Business logic. Expose:

/health/\* (public, no auth)

/api/<serverName>/\* (S2S-gated)

Put verifyS2S before all /api/\* routes.

Rule of steel: Gateway → Services (direct). Services → Services go via Gateway-Core.
Forbidden: Gateway → Gateway-Core.

3. Canonical Flows
   3.1 Edge (Client) → Gateway → Service (S2S minted by Gateway)
   Client ──HTTP──> Gateway (4000)
   Gateway: - Strip client Authorization - Mint S2S(iss=S2S_ISSUER, aud=S2S_AUDIENCE, sub=service:gateway, jti, exp≤MAX) - Proxy to target Service /api/\*
   Service:

- verifyS2S (global for /api/\*)
- controller → repo → model

3.2 Service → Gateway-Core → Service (S2S minted by Gateway-Core)
Service A ──HTTP──> Gateway-Core (4011)
Gateway-Core: - Mint S2S(...) - Proxy to Service B /api/\*
Service B:

- verifyS2S (global for /api/\*)

3.3 Health (no auth, no tokens)
Gateway /api/<svc>/health/_ ──> <svc>/health/_
(health lives at root on services; never under /api)

4. JWT (S2S) Policy

Algorithm: HS256
Claims (required):

iss: S2S_ISSUER (e.g., gateway, gateway-core)

aud: S2S_AUDIENCE (e.g., internal-services)

sub: service:<caller> (e.g., service:gateway, service:act)

exp: now + ≤ S2S_MAX_TTL_SEC

iat: now

jti: UUID

Claims (optional):

svc: caller code (gateway, act, etc.)

scope: "s2s" or operation-scoped (e.g., "geo:resolve")

Never forward the client’s token downstream. Always mint a fresh S2S at the proxy hop (Gateway or Gateway-Core).

5. Routing & Paths
   5.1 Gateway path mapping

Inbound: /api/<service>/<rest>

Outbound:

If <rest> starts with health/ → <SERVICE_URL>/health/<rest[1..]> (no S2S)

Else → <SERVICE_URL>/<OUTBOUND_API_PREFIX>/<rest> (with S2S)

Env contract: <SERVICE>\_SERVICE_URL (e.g., USER_SERVICE_URL, ACT_SERVICE_URL, GEO_SERVICE_URL)

INBOUND_STRIP_SEGMENTS=1, OUTBOUND_API_PREFIX=/api

5.2 Service path shape

Health: /<service>/health not required in path; use /health/\* at root

API: /api/<serverName>/_ (e.g., /api/user/_, /api/acts/\*)

No barrels or route logic: routers are one-liners that import handlers.

6. Method Semantics (Collections vs Resources)

Create

PUT /api/<serverName> (collection root)

Mongo generates \_id

No POST / and no PUT /:id replaces.

Why PUT? Idempotence at the collection boundary by contract; our controllers validate payloads and the model fills defaults.

Read

GET /api/<serverName> (list)

GET /api/<serverName>/:id (by id)

Other GETs (e.g., search, by email) are fine.

Mutate existing

PATCH /api/<serverName>/:id partial update

DELETE /api/<serverName>/:id

Kill switch: Never implement PUT /:id (replace-by-id). This drifts teams into overwriting server-owned fields and breaks our DB-driven identity model.

7. Auth Layers (where checks happen)

Gateway: edge policy (rate limit, HTTPS, etc.), mints S2S for /api/\*, health passthrough.

Services: verifyS2S mounted before /api/\*. That’s the only auth gate needed for service endpoints in this system.

Per-route client authenticate: Do not add to service routes unless a business case requires both S2S and end-user identity (rare). Default is S2S-only inside the mesh.

8. Responsibilities by Layer

Controller

Validate (Zod DTOs derived from contracts).

Log entry/exit with requestId.

Call repo; push audits to req.audit[].

Return domain object; no persistence details.

next(err) on failure (global Problem+JSON handles shape).

No token minting, no date stamping, no route logic.

Repo

Thin data access. Return domain-safe/plain objects (lean({ getters:true, virtuals:true })).

No field soldering (dates, IDs, etc.). No side effects outside the DB.

Zero knowledge of HTTP.

Model

Persistence-only: indexes, bufferCommands=false, timestamps/defaults.

Stamp dateCreated/dateLastUpdated (via Mongoose timestamps or defaults + hooks).

Sensitive fields (e.g., password) are select:false; only explicit code paths opt-in.

9. Observability & Cross-Cutting

Request ID: x-request-id required; Gateway preserves and forwards; services log it at entry/exit.

Logging: pino-http with service name; auto-silence health routes. 4xx→warn, 5xx→error.

Audits: Controllers push entries to req.audit[]; middleware flushes once per request.

Errors: Global Problem+JSON middleware only. Controllers never hand-craft 4xx/5xx payloads.

Rate limits: Gateway global + “sensitive” limiter.

Timeouts / Circuit breaker: Gateway applies per-upstream; services use reasonable axios/mongo timeouts.

Cache: GETs may use cacheGet(ns, TTL_ENV); mutations wrap with invalidateOnSuccess(ns).

10. Health & Readiness

Each service mounts:

GET /health/live (basic liveness)

GET /health/ready (dependencies OK)

Placed before any auth/limits.

Gateway rewrites /api/<svc>/health/_ → <svc>/health/_ and does not attach S2S.

11. Environment Contracts (assert at boot)

Gateway

INBOUND_STRIP_SEGMENTS=1

OUTBOUND_API_PREFIX=/api

S2S_SECRET, S2S_ISSUER, S2S_AUDIENCE, S2S_MAX_TTL_SEC

<SERVICE>\_SERVICE_URL per downstream

Gateway-Core

Same S2S vars as gateway

Upstream service URLs it calls

Services

Per-service \*\_PORT

\*\_MONGO_URI

Any service-specific defaults (e.g., ACT_DISTANCE_DEFAULT_MI, cache TTL envs)

USER_BUCKETS etc. for partition helpers (asserted at boot)

Required envs asserted: Fail fast on startup. No soft fallbacks.

12. Data Invariants & Dates

\_id: Mongo-generated; never accepted from client.

dateCreated/dateLastUpdated: set by Model (timestamps or pre-hooks). Controllers never set these.

Contract requires ISO datetimes? Ensure Models expose getters or timestamps that serialize to ISO, and repos use lean({ getters:true, virtuals:true }).

13. Hard Rules (printable checklist)

⛔ No Gateway → Gateway-Core calls.
✅ Gateway proxies directly to services and mints S2S for /api/\*.

⛔ Do not forward client tokens to services.
✅ Always mint new S2S at each proxy hop.

⛔ No PUT /:id.
✅ Create at collection root (PUT /api/<serverName>). Update with PATCH /:id.

⛔ No health under /api.
✅ Health is at root; gateway rewrites /api/<svc>/health/_ → /health/_ (no S2S).

⛔ No logic in routes.
✅ One-liners that import handlers only.

⛔ No barrels/shims/hacks.

✅ verifyS2S mounted before /api/\* in every service.

✅ Controllers: validate → repo → return domain → push audits → next(err).

✅ Global Problem+JSON only; no bespoke error payloads.

✅ RequestId logs on entry/exit; audits flushed once.

✅ Seeds idempotent; tests green via gateway & direct; coverage ≥90%.

14. Example Mappings (authoritative)

Gateway
/api/user/user → USER_SERVICE_URL/api/user (with S2S)
/api/user/health/live → USER_SERVICE_URL/health/live (no S2S)
/api/act/acts/123 → ACT_SERVICE_URL/api/acts/123 (with S2S)

Service (User):

PUT /api/user → create

GET /api/user/:id → read

PATCH /api/user/:id → partial update

DELETE /api/user/:id → delete

Service (Act): same pattern as User.

15. Testing Posture (smoke + unit)

Smoke tests use S2S tokens that match the hop:

Direct to service: S2S minted as “gateway-core” or appropriate issuer.

Via gateway: caller token irrelevant; gateway mints its own S2S.

Via gateway-core: gateway-core mints S2S to the downstream.

Health tests never attach Authorization.

CRUD smokes: single PUT (no “preflight” mutable checks), unique fields per run to avoid E11000.

16. Security & Rotation

Keep S2S secret in secure store; rotate on schedule.

Enforce short TTL (S2S_MAX_TTL_SEC), validate iss/aud strictly.

Services must only trust tokens minted by known issuers (gateway, gateway-core).

17. Glossary

S2S: service-to-service token minted by the proxy hop (gateway or gateway-core).

verifyS2S: service middleware that validates S2S before /api/\*.

serverName: env/config key used in route namespace (e.g., "user", "acts").

18. Rationale (why these rules)

Single source of truth for identity & dates: DB/model, not controllers.

Token hygiene: never propagate untrusted client tokens inside the mesh.

Replace-by-id ban: prevents silent field clobbering and preserves server ownership of state.

Health isolation: liveness must be callable when auth systems are degraded.

Operational clarity: logs, audits, and errors standardized → easy triage.
