adr0038-route-policy-gate-and-facilitator-endpoints
# ADR-0038 — Route Policy Gate at Gateway & Facilitator RoutePolicy Endpoints

## Context
We’re introducing edge security at the gateway without entangling it with JWT verification. All API endpoints are **private by default**; a small subset (e.g., `auth.create`, `auth.signon`) must be explicitly marked **public** to allow anonymous access. Policies must be dynamic (editable at runtime) and **environment-invariant**. The gateway should not hardcode routes or make assumptions — it should consult a **routePolicy** source of truth provided by **svcfacilitator** and maintain a short-lived TTL cache for performance.

Constraints & Non‑negotiables (from SOP & addenda):
- **Environment invariance**: no literals, no fallbacks. Fail fast if required config is missing.
- **Frozen plumbing**: JWT validation is a separate concern from policy lookup.
- **Single-concern classes**: route-policy lookup/cache is its own middleware.
- **Contract-first**: shared Zod contracts for request/response; both sides import same schemas.
- **Dev == Prod**: only env values differ.

## Decision
1) **Authoritative Policy Store**: Add a new `routePolicies` collection keyed by the parent `_id` of a `service_configs` record. The **svcfacilitator** service exposes CRUD for route policies.
2) **Gateway RoutePolicy Gate**: New middleware `routePolicyGate` runs **before** JWT verification. For each non‑health API request:
   - Resolve `<slug>`, `<version>`, and the **service-local path** (after gateway proxy stripping).
   - Lookup policy in an in-memory **TTL cache** (configurable TTL). On cache miss, **lazy-load** from facilitator via `GET /api/svcfacilitator/v1/routePolicy?svcconfigId=<id>&path=<...>&method=<...>`.
   - **Default deny**: If no policy found, treat as **private** (JWT required). If policy is `public`, allow through to the next gate without a JWT.
3) **Public Exceptions**: Seed routePolicies for `auth.create` and `auth.signon` as **public** to support anonymous onboarding.
4) **Contracts**: Add shared contracts for:
   - **Request**: query & body shapes for GET/POST/PUT routePolicy.
   - **Response**: normalized routePolicy DTO(s) and list results.
5) **Smoke Coverage**: Add smoke tests:
   - Facilitator: CRUD endpoints respond and validate per contract.
   - Gateway: routePolicyGate blocks protected user CRUD without JWT; allows `auth.create` and `auth.signon` per seeded policies.
6) **Separation of Concerns**: JWT minting/validation is addressed in a **separate ADR** and implementation PR.

## Consequences
- **Pros**
  - Centralized, dynamic authorization posture; no hardcoded route auth.
  - Minimal latency via TTL cache; correctness via lazy-loading from source of truth.
  - Small blast radius: policy gate is orthogonal to JWT logic.
  - Contracts shared → fewer drift bugs.
- **Cons / Risks**
  - Cache staleness within TTL window. Mitigations: short TTL, manual bust endpoint later.
  - New persistence surface (`routePolicies`) and CRUD semantics.
  - Availability coupling: if facilitator is down and cache empty, gateway will **fail closed** (by design).

## Implementation Notes
### Data Model (Mongo)
`routePolicies` (per service_config `_id`):
- `_id`: ObjectId
- `svcconfigId`: ObjectId (FK → `service_configs._id`)
- `method`: enum in {PUT, PATCH, GET, DELETE, POST}  // cover CRUD + auth ops
- `path`: string (service‑local path beginning with `/`, e.g., `/users`, `/auth/signon`)
- `version`: number (API major version, e.g., 1)
- `policy`: enum in {public, private}  // default is **private**
- `createdAt`, `updatedAt`: ISO dates

**Uniqueness**: (`svcconfigId`, `version`, `method`, `path`) unique index.

### Facilitator Endpoints (initially mocked handlers)
- `GET    /api/svcfacilitator/v1/routePolicy`  — query by `svcconfigId`, `path`, `method`, `version`; returns single or none.
- `POST   /api/svcfacilitator/v1/routePolicy`  — create one policy.
- `PUT    /api/svcfacilitator/v1/routePolicy/:id` — update one policy.
- (Later) `GET /api/svcfacilitator/v1/routePolicy/list?svcconfigId=...` — list policies for a service.

### Shared Contracts (Zod)
- **Queries/Params**: `svcconfigId` (string ObjectId), `version` (int ≥1), `method` (enum), `path` (normalized `/...` string).
- **DTO**: canonical policy object with the fields above (snake vs camel handled consistently; choose camel consistently).
- **Envelope**: unchanged. Requests are **flat bodies** (no envelope). Responses are **enveloped** (RouterBase standard).

### Gateway Middleware `routePolicyGate`
Order in `app.ts` (or equivalent orchestration file):
1. health
2. **routePolicyGate**  ← this ADR
3. verifyS2S / JWT gate (next ADR)
4. body parsers
5. routers

Behavior:
- Skip for health paths.
- Build cache key: `${svcconfigId}|v${version}|${method}|${path}`.
- Get-or-fetch policy; cache result for TTL.
- If policy missing or `private` and request lacks a valid JWT header, call `next(Problem.unauthorized(...))`.
- Otherwise `next()`.

### Env / Config (fail-fast if missing)
- `SVCFACILITATOR_BASE_URL`
- `ROUTE_POLICY_TTL_SECONDS` (e.g., 10–60)
- `NV_ENV` (for logging only; no branching behavior)

### Seeding
- Use a small console tool to POST/PUT two **public** policies tied to the `auth` service’s `service_configs._id`:
  - `PUT /auth/v1/create` → `public`
  - `POST /auth/v1/signon` → `public`

### Telemetry
- Log cache hits/misses, fetch latency, and policy decisions (ALLOW_PUBLIC / DENY_PRIVATE / REQUIRE_JWT). SECURITY category for denials; AUDIT remains separate.

## Alternatives Considered
- **Hardcoded allowlist in gateway** — rejected (environment variance, redeploy for changes, brittle).
- **Bundle policies with service manifests** — rejected for now; we want a single live source of truth (facilitator) used by gateway and operators.
- **Push model (facilitator → gateway)** — viable later; start with lazy GET + TTL to keep plumbing thin.

## References
- SOP: Backend — Core SOP (Reduced, Clean)
- ADR-0007 — SvcConfig Contract — fixed shapes & keys, OO form
- ADR-0020 — SvcConfig Mirror & Push Design
- Addendum: Environment Invariance (Critical)
- Addendum: Single-Concern Class Principle
- Addendum: Best-in-Class Over Minimal Diffs
