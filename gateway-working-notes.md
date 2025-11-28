# Gateway Working Notes — Legacy Behavior + New NV Plan

## 1. What the **old gateway** actually does

### 1.1 App wiring (`src/app.ts`)

- Express app with:
  - `requestIdMiddleware()` and `makeHttpLogger("gateway")`.
  - Gateway’s own **self-health** via `createHealthRouter({ service: "gateway" })`.
  - **Unversioned worker health proxy** mounted before API routes:
    - `app.use(healthProxy);` → handles `/api/:slug/health/*`.
  - Versioned API surface at `/api`:
    - `app.use("/api", api);` where `api` is the main forwarding router.
  - Tail middleware:
    - `notFoundProblemJson([...paths])` then `errorProblemJson()`.

**Key takeaway:** Old gateway is already thin: it wires health, health proxy, one API router, then standard Problem+JSON tails.

---

### 1.2 Versioned API routing (`src/routes/api.ts`)

- Route shape: `/api/:slug/:version/*`
  - `slug` = target service (auth, user, etc.), **not** “gateway”.
  - `version` normalized via `normalizeVersion()` → `"V1"`, `"V2"`, etc.
  - Express wildcard for the rest of the path.
- `api.use("/:slug/:version/*", express.json({ limit: "2mb" }));`
  - JSON body parsing only for versioned API routes.
- `parseParams()`:
  - Normalizes and validates `slug` (lowercase, `[a-z][a-z0-9-]*`).
  - Normalizes `version` (requires V-prefixed form).
  - Extracts `restPath` from the wildcard segment.
  - Attaches `(req as any).parsedApiRoute = { slug, version, restPath }`.
- Main catch-all:
  ```ts
  api.all(
    "/:slug/:version/*",
    parseParams,
    enforceRoutePolicy,
    forwardToService
  );
  ```
- **Division of labor:**
  - `parseParams`: path → `{slug, version, restPath}`.
  - `enforceRoutePolicy`: consults route policy & user JWT.
  - `forwardToService`: does the actual S2S proxy call.

**Key takeaway:** The old gateway parses once, enforces policy, then forwards everything through a single handler — exactly the shape we want, just on the old rails.

---

### 1.3 Health proxy (`src/routes/healthProxy.ts`)

- Public, unversioned health endpoints:
  - `GET /api/:slug/health/live`
  - `GET /api/:slug/health/ready`
- Uses **svcconfig-style resolution** to find the target service and hit its own `/health/live` or `/health/ready`.
- Behavior:
  - Unknown slug or resolution failure ⇒ 502.
  - Timeout ⇒ 504.
  - Error responses returned as JSON with `type`, `title`, `detail`, `status`.

**Key takeaway:** Health for workers is proxied through gateway without versioning in the legacy design; our new SOP wants versioned health (`/api/<slug>/v1/health`), so we’ll need to **modernize this pattern** rather than blindly copy it.

---

### 1.4 Forwarding logic (`src/handlers/forwardToService.ts`)

- Central handler for **all** versioned API traffic.
- Uses shared S2S client:
  - `callBySlug(slug, version, { method, path, query, headers, body, ... })`
  - This is the old `@eff/shared` callBySlug; conceptually the same thing we’ll do with the new `SvcClient` / `callBySlug` in `@nv/shared`.
- Rules:
  - **Never** forwards client `Authorization`.
  - Mints S2S headers upstream:
    - `x-request-id` propagated.
    - `content-type`, `accept` copied.
    - `x-nv-user-assertion` forwarded as a separate header.
    - Everything else “safe” from `req.headers` (minus `authorization`) passed along.
  - Body:
    - Assumes JSON (the router applied JSON parser), passes body through without re-serializing.
- Response handling:
  - Accepts various `S2SResponse` shapes: `{ body }`, `{ data }`, `{ payload }`, `{ text }`, `{ buffer }`.
  - Maps status and headers to the client.
  - If upstream sends **non-JSON error text**, wraps it into **Problem+JSON** via `problemFromText()`.
  - Strong discipline around `headersSent` checks and single-write behavior.

**Key takeaway:** Old forwarder is **exactly** what we want conceptually: one handler that turns “API path + method + body” into an S2S call, with strict rules on headers and error normalization.

---

### 1.5 Route policy & JWT (`src/middleware/enforceRoutePolicy.ts` + `src/policy/policyTypes.ts`)

- `RoutePolicy` model:
  ```ts
  export interface RouteRule {
    method: string;
    path: string;
    public: boolean;
    userAssertion: "required" | "optional" | "forbidden";
    opId?: string;
  }

  export interface RoutePolicy {
    revision: number;
    defaults: { public: boolean; userAssertion: UserAssertionMode };
    rules: RouteRule[];
  }
  ```
- `enforceRoutePolicy`:
  - Expects `(req as any).parsedApiRoute = { slug, version, restPath }`.
  - Looks up a route rule from a **local svcconfig mirror** (or equivalent).
  - Decides:
    - Is the route public?
    - Is a **user JWT** required/optional/forbidden?
  - Uses **lazy dynamic import** for `jose` so TS doesn’t down-level to `require()`.
  - Caches a remote JWKS (`USER_JWKS_URL`) for JWT validation.
- This layer is about **user auth**, not S2S; gateway enforces end-user tokens here.

**Key takeaway:** The old gateway already has a clean “route policy via svcconfig mirror + JWKS JWT validation” pattern we can port later. For the first minimal step we’re **not wiring JWT yet**, but we know the shape.

---

### 1.6 Service resolution (`src/utils/serviceResolver.ts`)

- Centralizes how the gateway finds upstream URLs:
  - Uses svcconfig entries (env + slug + version) to resolve:
    - protocol
    - host
    - port
    - base path
  - Distinguished:
    - **Internal resolution** (worker-only; ignores `allowProxy`).
    - **Public resolution** (requires `allowProxy=true`).
- Handles version canonicalization:
  - External path versions look like `V1` / `v1`.
  - svcconfig stores numeric version (`1`).
  - Resolver normalizes external form to match svcconfig’s canonical version.

**Key takeaway:** svcconfig holds the routing brain; the gateway just reads it and uses it to map `slug + version + restPath` ⇒ `http://host:port/<restPath>`.

---

### 1.7 Readiness (`src/readiness.ts`)

- Gateway readiness depends on **upstream health**:
  - Env `GATEWAY_READY_UPSTREAMS` = comma-separated list of required slugs.
  - Normalized to `REQUIRED_UPSTREAM_SLUGS` (lowercase, trimmed, non-empty).
  - Throws if list is empty → boot-time failure.
- For each required upstream:
  - Resolves its health URL via svcconfig.
  - Calls `/health/ready` (unversioned in the legacy model).
  - Aggregates results to decide if gateway is “ready”.
- Intended to plug into `createHealthRouter` readiness hook (though in the old app it’s not fully wired yet).

**Key takeaway:** The legacy gateway already bakes in “gateway not ready unless its dependencies are ready” — we want that same idea under the new env-service / svcconfig rails.

---

### 1.8 Audit / WAL (`src/services/auditWal.ts`, `src/services/auditDispatch.ts`)

- Local WAL implementation:
  - NDJSON files under `var/audit/` (we see real .ndjson files in the repo).
  - Rotation, retention, at-least-once semantics.
- `auditDispatch` coordinates flushing WAL records to a downstream audit service (or equivalent).
- Lots of state: current file, cursor, retry attempts, etc.

**Key takeaway:** Old gateway owns its own WAL; in the new NV world, we already have a **shared WAL/audit subsystem**. Gateway will eventually use that instead of bespoke WAL logic. For the first “proxy-only” step, WAL isn’t critical — but we keep the design intent: every mutation is auditable.

---

## 2. What you explicitly want for the **new** NV gateway

From your instructions + SOP/LDD compression, boiled down:

1. **New gateway = cloned from `t_entity_crud` template**
   - It must use the **same rails**:
     - envBootstrap via env-service
     - AppBase
     - svcconfig client
     - DTO registry
     - DtoBag-only responses
     - Shared handlers/pipelines pattern.
   - Even though gateway is **not** an entity CRUD service, it still must look and behave like all other services on the common rails.

2. **Strip CRUD; keep rails**
   - Remove all CRUD-specific:
     - Routes
     - Controllers
     - Pipelines/handlers that assume a local entity/collection.
   - Keep:
     - Boot sequence
     - Health wiring
     - svcenv / svcconfig wiring
     - SvcClient
     - Controller/Handler infrastructure.
   - Gateway’s core “entity” is basically **proxy behavior**, not a Mongo collection.

3. **First feature: a proxy route built on shared handler `s2sClientCall.handler.ts`**
   - Add a new route (under the current `http(s)://<host>:<port>/api/<slug>/v<major>/<dtoType>/<rest>` convention) that:
     - Uses a **proxy controller**.
     - The controller’s pipeline wires in the shared `s2sClientCall.handler.ts` from `@nv/shared`.
   - The handler’s job is conceptually the same as old `forwardToService`:
     - Take the parsed incoming route (slug, version, rest).
     - Use SvcClient / callBySlug to contact the worker.
     - Never forward client `Authorization`.
     - Preserve requestId and safe headers.
     - Map upstream response → gateway response (Problem+JSON on errors).

4. **Gateway’s responsibilities (for every proxied call):**
   - Edge **guards** (now or later):
     - Rate limiting
     - Route policy (public vs protected)
     - User JWT auth (via Auth service / JWKS)
   - S2S identity minting (via SvcClient on the backend).
   - Logging + auditing (via shared logger and WAL subsystem).
   - **Proxy semantics only**:
     - Take an inbound `/api/<slug>/v<major>/<...>` request.
     - **Switch the port/host** using svcconfig lookup.
     - Forward the request internally with as little mutation as possible.
   - No business logic, no entity CRUD in gateway itself.

5. **Incremental approach (no heroics):**
   - Only add one small piece at a time:
     1. Remove CRUD routes/controllers.
     2. Add the minimal proxy route + controller + pipeline using `s2sClientCall.handler.ts`.
     3. Wire tests (smokes) and make sure they pass.
   - **Do not** add new gateway features until the previous step’s tests are green.
   - No shims, no hacks, no “temporary” shortcuts:
     - Greenfield, we own all interfaces.
     - dev == prod behavior (aside from URLs/ports).

6. **Health & versioning alignment**
   - Old gateway used **unversioned** worker health paths (`/api/:slug/health/...`).
   - New SOP says:
     - URL convention: `/api/<slug>/v<major>/<dtoType>/<rest>`
     - Health is versioned: `/api/<slug>/v1/health`.
   - So when we rebuild:
     - We need to design the **new health proxy** (and readiness) under the versioned pattern.
     - Old behavior is a reference, not a spec.

---

## 3. How to use these notes at session start

When we pick this up again, you can paste something like:

> “Gateway Working Notes — Legacy Behavior + New NV Plan”  
> (then the sections you want from above)

And we’ll be aligned that:

- The **goal** is a DTO-rails-compliant gateway that acts as a pure proxy layer.
- The **first concrete task** is:
  - Strip the cloned CRUD routes/controllers.
  - Introduce a new “proxy route + controller + pipeline” that uses `s2sClientCall.handler.ts` and mirrors the old `api.ts + forwardToService` behavior, but on the **new** SOP rails and path conventions.
