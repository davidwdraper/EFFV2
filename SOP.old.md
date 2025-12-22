# NowVibin Backend — Core SOP (Reduced, Clean) [Concise Version]

## Prime Directives

- Never overwrite unseen work — always start from the current file.
- Single-concern files; shared logic lives only in `backend/services/shared`.
- Full file drops only; no partials, no options.
- No barrels or shims.
- Env names only — not hard coded values or fallbacks
- Routes are one-liners; controllers orchestrate pipeline of handers.
- Instrumentation everywhere; global error middleware via `problem.ts`.
- Audit-ready: explicit env validation, no silent fallbacks. Dev ≈ Prod (URLs/ports aside).
- Canonical truth = DTO
- Always TypeScript OO; base classes shared where appropriate.

---

## Route & Service Rules

- URL: `http(s)://<host>:<port>/api/<slug>/v<major>/<dtoType>/<rest>`
  - Health is versioned: `/api/<slug>/v1/health`
- CRUD (versioned paths):
  - `PUT` create
  - `PATCH` update
  - `GET` read
  - `DELETE` idempotent delete
- No `PUT /:id` full replaces.
- Gateway strips `<slug>` and proxies via svcconfig replacement port value.
- Mount health before auth/middleware.

---

## Template Service Blueprint

Flow: \*\*route -> controller -> pipeline -> handlers -> DtoBag(DTO) -> service API

- Model: `bufferCommands=false`; indexes defined.
- Repo: comprises shared DbReader and DbWriter helpers that work with DTOs
- DTOs never leave a module boundary outside a DtoBag wrapper

---

## Safe Field Add SOP

1. update DTO → done.
2. Add 2 tests: DTO round-trip + minimal controller.

---

## Logging & Audit

- Shared logger; propagate `x-request-id`.
- WAL audit flushes once per request.
- SECURITY logs ≠ WAL logs. WAL not complete yet.
- Every meaningful operation should be logged at `info` level.
- Heavy instrumentation with `debug` logs for traceability.
- When the Logger service is complete, log levels will be runtime-adjustable and can optionally forward to the log DB for production triage.

---

## Security & S2S

- Only gateway is public; all others require valid S2S JWT (JWT not in place yet)
- `verifyS2S` runs after health, before body parsers/routes. (Not in place yet)
- Gateway never forwards client `Authorization`.
- All S2S calls via shared `SvcClient` (`callBySlug`).

---

## Deployment

- Dev/local: HTTP allowed on 127.0.0.1.
- Staging/prod: HTTPS only, `FORCE_HTTPS=true`, HTTP→308.

---

## Session Ritual

Paste SOP → declare active service → paste full current files → merge drops only.
Be pro-active. Warn if session is getting too bloated for your efficient processing

---

## File Discipline

- Repo Path/Filename on 1st line
- ADR refs.
- Inline “why,” not “how.”
- Always ensure wiring is complete.
- Never drift; ask if logic exists before adding.
- All returned files in a code block

---

## Process Notes

- Design discussion → file drop → test → next file.
- One file at a time unless requested.
- Reuse in shared; use DI where logical.
- Baby steps — correctness over speed.
- Never take a fast path over long-term correct path
- Never provide options, always take best long-term commerical path
- Project is new and greenfield with no clients. All internal interface to be explicit.
- Never leave code incomplete with "come back later" comments. All code 100% before moving on.

---

## Environment Invariance

- No literals or defaults tied to env.
- All config from env or svcconfig.
- Fail-fast if missing config.
- Dev == Prod behavior.
- No backward compatibility; greenfield only.
- “Could this line ship to prod unchanged?” If not, fix it.

---

## App.ts = Orchestration Only

- Defines **what** happens, not **how**.
- Wires base classes, middleware, and routes.
- No business logic — that lives in `services`, or `handlers`.
- Think of `app.ts` as a “runtime table of contents.”

---

## Single-Concern Classes

- One reason to change.
- No mixing validation/persistence/routing/mapping.
- Classes >200 lines or multi-purpose → split.
- Each class must be describable in one sentence.
- Shared base classes only for true cross-service concerns.

---

## Best-in-Class > Minimal Diffs

- Correctness > smallest edit.
- Fix plumbing, don’t bend it.
- Bugs fixed at edges, not middle layers.
- Delete cleverness; prefer boring, explicit code.

---

## DTO-First Development

- DTOs are canonical; domain data lives only in DTOs.
- DTO data is used via getters but never lives outside the DTO.
- Each DTO inherits from `DtoBase` and implements `IDto`.
- DTO validates and authorizes its own data (getters/setters).
- Multiple DTOs for same entity service only with clear justification (e.g., internal vs. public view).
- If a DTO leaves the service boundary, it must be defined under `services/shared/src/dto/<slug>.<purpose>.dto.ts`.

---

## Template Service Types

- `t_entity-crud`: DB-backed CRUD template (with live test DB).

The following are templates yet to be built

- `micro-orchestrator (MOS)`: cross-service coordination. Multiple DTO types expected.
- `api-adapter`: interfaces external APIs.
- `daemon`: cron/background task.  
  Each is fully runnable by cloning and assigning a port.

---

## Crud Template File Hierarchy

```
backend/services/t_entity_crud/
└─ src/
   ├─ index.ts              → bootstrap only
   ├─ app.ts                → orchestration only (extends AppBase)
   ├─ routes/
   │   ├─ <route>.route.ts
   ├─ controllers/
   │   ├─ <route>.controller/
   │   │     └─ pipelines
   │   │           ├─ <op>.pipeline1
   │   │           │    ├─handlers/
   │   │           │    │   ├─ <purpose>.handler1.ts
   │   │           │    │   └─ <purpose>.handler2.ts
   │   │           │    └─ index.ts
   │   │           ├─ <op>.pipeline2
```

Handlers with common functionality are located in:
backend/services/shared/src/http/handlers

**Rules:**

- Handlers = single-purpose (think: could be resused)
- Services = cross-handler logic. Shared if cross service.
- DTOs = data authority.
- Peristence within handlers via DbWriter, DbReader and DbDeleter
- Controllers = orchestrators only.
  If data lives outside a DTO - it's drift

---

## UserType Enum

```ts
export const enum UserType {
  Anon = 0,
  Viber = 1,    (no fee)
  Prem-Viber = 2,   (monthly fee)
  NotUsedYet = 3,
  AdminDomain = 4,
  AdminSystem = 5,
  AdminRoot = 6,
}
```

shared files can be accessed at:
@nv/shared/
rather then ../../../shared/src/
Files within shared, do not use @nv/shared/

When throwing errors, ensure the message includes guidance and suggestions for Ops
to triage the situation.

No models, no schemas, no mappers, no leaked shapes. The DTO is the only source of truth, and persistence just moves opaque JSON in/out via dto.toJson() / DtoClass.fromJson().

Always provide ADR docs as downloadable .md files. Ask for next # at start of session.

As we work our way through building out the backend, there may be time that refactoring is required. We never build shims, or fallbacks, or worry about back-combat. We're greenfield and in total control of all interfaces - everything needs to tight. If entity A needs a function in B that doesn't exist, we don't add it to A, we put it in B where it belongs.

No helper methods to narrow TS type guards. All typing must be designed and implemented correctly. There must be a good valid reason for the type 'any'.

When fixing issues or bugs, never offer two or more solutions when one is clearly the preferred. We are never doing quick fixes and always require the best long term production solution. dev == prod.

Be pro-active on when its time for a new session, when we're diverging from the ADRs, or when I'm suggesting something that screams "not best practice".

# LDD COMPRESSION — WORKING SET FOR SOP USE

This file is the **working compression** of all LDDs (00–34).  
It is meant for **day-to-day architectural enforcement**, not as a replacement for the full docs.

Each LDD below:

- Captures **purpose + rules + invariants**
- Is short enough to keep in working memory
- Is strict enough to say “that’s illegal” when code drifts

---

## LDD-00 — Shared CRUD Rails (Env-Backed Services)

- All CRUD-style services cloned from `t_entity_crud` share the same rails: envBootstrap → SvcClient(env-service) → AppBase.boot → Registry.ensureIndexes → routes/controllers/pipelines/handlers.
- DTO-first: persistence only ever sees `dto.toJson()`; no models, no schemas, no leaked shapes; DTOs are canonical.
- Requests are always wrapped in a **wire bag envelope**: `{ items: [...], meta: {...} }`.
- DtoBag is immutable, ordered, and may be singleton for operations that must act on exactly one DTO.
- Duplicate key behavior is standardized: `_id_` → `DUPLICATE_ID`, content/index duplicates → `DUPLICATE_CONTENT` or `DUPLICATE_KEY`, all via Problem+JSON.

---

## LDD-01 — NV Backend Overview (Broad, Strategic)

- NV backend is a **template-driven microservice platform**, with t_entity_crud as the canonical CRUD template and env-service / svcconfig as shared infra services.
- Every service obeys the same rails: env-backed config, DTO-only persistence, S2S-protected workers, gateway as the only public door.
- “Greenfield, no back-compat”: dev ≈ prod; no shims, no fallback hacks; fix the rails, not the edges.
- The LDD series documents shared rails (LDD-00..), service-specific designs (env-service, gateway, svcconfig, auth), and cross-cutting concerns (logging, error, S2S, WAL).

---

## LDD-02 — Boot Sequence

- Boot must be deterministic, fail-fast, environment-backed, index-verified, and fully instrumented.
- No service starts unless:
  - Its env exists in env-service,
  - Its svcconfig entry exists (port/slug/host/etc.),
  - Required DB indexes are present or created at boot.
- Canonical boot path:
  1. process start → envBootstrap (via SvcClient to env-service)
  2. AppBase boot (logger, svcEnv, svcconfig client, registry)
  3. Registry.ensureIndexes()
  4. Routes mounted (health first, then protected routes)
- Boot must **fail-fast** if env is missing, svcconfig is missing, or index build fails — no “best effort” startup.

---

## LDD-03 — envBootstrap & SvcClient

- envBootstrap replaces ad-hoc `.env` use with **env-service-backed configuration**; services fetch a DtoBag<EnvServiceDto> from env-service.
- SvcClient is the **canonical S2S client**: it understands service slugs, versions, and env labels, and resolves actual URLs via svcconfig.
- All S2S calls:
  - Must go through SvcClient / ServiceClient,
  - Must carry standard headers (`authorization`, `x-request-id`, `x-service-name`, `x-api-version`),
  - Must be able to evolve to JWT/mTLS/KMS without changing call sites.
- SvcEnv DTO encapsulates environment variables as a map; all access is via typed getters, never raw `process.env`.

---

## LDD-04 — AppBase & Core Runtime

- AppBase owns **wiring**, not business logic: logger, svcEnv, svcconfig client, health endpoint, error middleware, RequestId, and routing.
- App.ts per service must be orchestration only: “runtime table of contents” that wires AppBase and service routes.
- All middleware ordering is standardized:
  1. Health route(s)
  2. RequestId + logging
  3. (Future) verifyS2S for workers
  4. Body parsers
  5. Routes
  6. Problem+JSON error sink
- AppBase exposes a minimal surface to controllers and handlers (logger, svcEnv, svcconfig, registry).

---

## LDD-05 — DTO Registry & Indexing

- DTO registry maps stable **dtoType keys** → DTO constructors + metadata (collection name, index hints).
- Registry is the **single source of truth** for:
  - DTO constructors
  - Collection names
  - Index hints and deterministic index naming.
- No dynamic/fallback registry entries; all DTOs must be explicitly registered.
- ensureIndexes() runs at boot using registry metadata; boot fails if indexes cannot be created or verified.

---

## LDD-06 — Controller & Pipeline Architecture

- Controllers do orchestration only: `makeContext` → stamp dtoType/op/id → seed hydrator → select pipeline → run → finalize().
- HandlerContext is the key/value bus, storing dtoType, op, svcEnv, hydrate functions, bags, filters, and results.
- Pipelines are ordered lists of handlers; no branching inside handlers; all branching is done by the controller.
- Handlers are single-purpose, async, must set `handlerStatus` on errors, and never perform high-level branching.
- finalize() converts context into a canonical HTTP response, normalizing errors into Problem+JSON.
- **Multi-op pattern**: routes like `GET /:dtoType/:op` let controllers support multiple operations (e.g., `list`, `mirror`, `create`, `clone`) by switching on `op` and choosing the correct pipeline, with no route/controller duplication.

---

## LDD-07 — Handler Layer Deep Dive

- HandlerBase provides:
  - Shared logging (entry/exit),
  - Access to ctx and controller app context,
  - Error trapping and handlerStatus semantics.
- Handlers must:
  - Perform exactly one domain action,
  - Use ctx only via well-named keys,
  - Not perform cross-pipeline branching.
- Shared handler catalog (examples):
  - BagPopulate handlers,
  - LoadExisting handlers,
  - Patch/apply handlers,
  - DbRead/DbWrite handlers,
  - Query/list filter handlers.
- Handlers are designed to be **lego bricks**: reusable across pipelines and services when appropriate, via shared handler locations.

---

## LDD-08 — Bag & BagView Architecture

- DtoBag is an immutable, ordered collection of DTOs; all bag operations produce new bags.
- Bag invariants:
  - Items are DTO instances (never raw JSON),
  - Order is meaningful for list operations,
  - Singleton expectations are enforced by helper handlers.
- DtoBagView provides read-only projections (e.g., toJsonArray()) for wire responses without exposing DTO internals.
- Bag semantics enable multi-create, list, and batch operations while keeping each DTO opaque and self-contained.

---

## LDD-09 — Persistence Architecture

- Persistence is DTO-only: DB layers work in terms of DTOs and DTO JSON, never arbitrary documents or schemaless blobs.
- DbReader/DbWriter encapsulate Mongo access:
  - Deterministic queries,
  - Respect index hints from the registry,
  - Support cursor-based batch reads for list operations.
- Collection names come from DTO metadata (registry/env-service), not hard-coded strings.
- All persistence errors are mapped into internal error codes and then Problem+JSON responses; no raw DB errors leak.

---

## LDD-10 — HTTP & Routing Architecture

- URL convention: `http(s)://host:port/api/<slug>/v<major>/<dtoType>/<rest>`.
- Health endpoints are versioned and always unauthenticated (`/api/<slug>/v1/health`).
- Gateway is the only public entrypoint; all other services are worker services behind S2S auth.
- Routing responsibilities:
  - Path structure only,
  - Mounting per-dtoType controllers,
  - No business logic in routes, one-liner wiring only.
- Error handling is centralized via Problem+JSON middleware; no per-route ad-hoc error formats.

---

## LDD-11 — Logging, Observability & Audit (High-Level)

- Every request carries `x-request-id`, propagated across services via SvcClient.
- All meaningful operations log at info, with debug logs for trace-level details.
- Health, boot, error, and S2S flows must be instrumented so that Ops can diagnose failures from logs alone.
- Audit signaling (WAL) is separated from normal logs; security events are distinct again from audit/WAL.

---

## LDD-12 — SvcClient & S2S Contract Architecture

- SvcClient (ServiceClient) is the **only** way to call other services: no raw URLs, no manual ports.
- It uses svcconfig + env-service data to resolve service endpoints and attaches standard S2S headers.
- S2S contract:
  - `authorization` (JWT or equivalent),
  - `x-request-id`,
  - `x-service-name`,
  - `x-api-version`.
- The design anticipates mTLS/JWT/KMS upgrades without breaking call sites; only SvcClient internals change.

---

## LDD-13 — Env-Service Architecture

- env-service is the canonical source of environment configuration variables for all services.
- Each (env, slug, version) combination yields a single EnvServiceDto holding key/value vars.
- Services call env-service at boot to populate svcEnv; no direct `.env` use in runtime logic.
- env-service supports reload semantics so services can refresh config without redeploy.

---

## LDD-14 — Gateway Architecture

- Gateway is the only public HTTP surface; all workers are private behind S2S.
- Responsibilities:
  - Host the client-facing API surface,
  - Proxy to worker services via svcconfig,
  - Enforce future auth and rate-limits,
  - Never forward user Authorization headers into workers.
- Routing at gateway strips `<slug>` and forwards to the correct worker base URL and port.

---

## LDD-15 — Audit & WAL Architecture

- Write-Ahead Log (WAL) records all domain mutations in an append-only fashion for replay and forensic analysis.
- Audit records are decoupled from business logic via handlers that push to WAL sinks.
- WAL ties mutations to requestId, actor, and minimal context, enabling reconstruction of “who did what when.”
- WAL is not a full event-sourcing engine but is strong enough for audit/regulatory needs.

---

## LDD-16 — svcconfig Architecture

- svcconfig stores service locations, slugs, versions, and related routing metadata in a DB-backed DTO.
- All routing decisions (gateway → worker) are ultimately derived from svcconfig, not hard-coded configs.
- Hot updates: svcconfig changes can update routing behavior without redeploying all services.
- svcconfig exposes list/read/mirror APIs so other services (gateway, orchestrators) can build in-memory mirrors of routing config.

---

## LDD-17 — Error Architecture & Problem+JSON

- All error responses conform to Problem+JSON (`type`, `title`, `detail`, `status`, `code`, `requestId`, optional `issues`).
- Controllers and handlers express errors by setting context fields; finalize() constructs the HTTP response.
- Duplicate key, validation errors, persistence errors, and S2S errors all map into structured internal codes.
- Errors must include operational guidance in `detail` when possible to aid Ops triage.

---

## LDD-18 — Logging Architecture (Focused)

- Logging policy:
  - info for business-level events,
  - debug for trace,
  - warn/error for exceptional or failed conditions.
- S2S calls log requestId, target slug, status, and timing.
- Boot logs identify env, slug, version, ports, DB URIs (sanitized) and index status.
- Logger configuration is env-service driven; log level can be tuned without code changes.

---

## LDD-19 — S2S Protocol Architecture

- S2S protocol defines:
  - Required headers (`authorization`, `x-request-id`, `x-service-name`, `x-api-version`),
  - Token semantics (issuer/audience/caller),
  - Standard error responses for S2S failures.
- `<slug>@<majorVersion>` naming pattern is canonical for S2S service identifiers.
- Health endpoints bypass S2S; all other protected routes must enforce verifyS2S once wired.

---

## LDD-20 — Rate-Limit Architecture

- Rate-limiting is applied at the gateway, not at each worker.
- Limits are normally by client identity / IP / token, not by raw path alone.
- Design supports:
  - Global limits,
  - Per-client tiered limits,
  - Burst control and sliding windows.
- Rate-limit violations must surface as Problem+JSON errors and be visible in logs for triage.

---

## LDD-21 — Auth Architecture (High-Level)

- Auth system governs user identity, roles, and permissions, separate from S2S auth.
- Token minting and verification are centralized; consumers should treat tokens as opaque.
- User types (Anon, Viber, Prem-Viber, Admin levels, etc.) are enforced by Auth service and propagated via tokens, not business services reinventing role checks.
- Auth decisions must be auditable and reflected in WAL/security logs.

---

## LDD-22 — DTO & Contract Architecture

- DTOs are canonical: they own validation, shaping, and field-level invariants.
- DTOs inherit from DtoBase and implement IDto; only DTOs cross persistence boundaries.
- Zod contracts define wire shape and validation; DTOs provide runtime behavior around those contracts.
- Public vs internal DTOs are split when needed, but both must be registered and documented.
- All changes to DTO fields follow Safe Field Add SOP (contract → DTO → handlers/tests).

---

## LDD-23 — Handler & Pipeline Architecture (Extended)

- Expands on LDD-06/LDD-07 with more concrete patterns:
  - Validate → DTO → Repo → Response as a canonical flow,
  - Policy gates, audit handlers, and S2S verification as separate handlers.
- Pipelines are built via `getSteps(ctx, controller)` functions that seed context (e.g., `list.dtoCtor`) then compose handlers.
- Multi-DTO and multi-op flows are modeled via different pipelines, never via big “smart” handlers.

---

## LDD-24 — Persistence Architecture (Extended)

- Clarifies DbReader/DbWriter contracts for CRUD and list/query operations.
- Emphasizes deterministic queries: sort orders must be explicit and stable, especially when using cursors.
- All DB operations must be index-supported; no collection scans in normal paths.
- Retry and error handling strategies are centralized, not scattered per call site.

---

## LDD-25 — Gateway Routing Architecture

- Explains gateway’s internal routing model in more depth:
  - How incoming paths map to svcconfig entries,
  - How versioning is respected at the gateway level,
  - How to add new slugs/routes without breaking older ones.
- Gateway is forbidden from doing business logic; it only mediates:
  - Auth (future),
  - Rate-limit (future),
  - Routing,
  - Response normalization.

---

## LDD-26 — svcconfig Architecture (Extended)

- Deep dive for svcconfig DTO shape and semantics:
  - Fields like env, slug, version, host, port, protocol, role, enabled flags, etc.
- Describes how mirrors are populated (e.g., `list` vs `mirror` operations) and how filters are applied.
- svcconfig is the source of truth for:
  - Service discovery,
  - Routing targets,
  - Environment/version awareness.
- Gateway and other orchestrators are expected to cache/mirror svcconfig in memory, but svcconfig remains authoritative.

---

## LDD-27 — WAL & Audit Architecture (Extended)

- Clarifies how WAL integrates with services:
  - Where handlers emit WAL records,
  - How WAL is transmitted (HTTP/DB),
  - How WAL replay could rebuild state in a pinch.
- WAL entries are strongly structured (who, what, when, where, why) and keyed to requestId.
- WAL storage can be rotated and archived; retained duration is a policy, not a hard-coded rule.

---

## LDD-28 — Auth Service Architecture (Concrete Service)

- Details the Auth service’s API surface (login, refresh, validate, role assignment).
- Password rules, hashing, and credential storage are explicitly specified (no plain text, strong hash algorithms).
- Tokens include minimal necessary claims (user id, roles, expiry), not application-specific business fields.
- Auth integrates with S2S rules to ensure workers trust only tokens minted by the Auth service.

---

## LDD-29 — Error Semantics & Operator Guidance

- Error codes and messages must be meaningful to Ops, not just developers.
- For each major error class (validation, auth, S2S, persistence, routing, env, svcconfig), there is:
  - A standard code,
  - A standard recommended `detail` message,
  - A troubleshooting checklist for Ops.
- This LDD is the guide for “what to put in `detail`” when throwing errors so on-call staff know what to do.

---

## LDD-30 — Versioning & Backward Compatibility

- Despite “no back-compat”—internally—**APIs still version** (`v1`, `v2`, …) and must not silently break consumers.
- Guidelines:
  - Additive changes only in minor revisions,
  - Breaking changes require new major version paths,
  - DTO and svcconfig changes must coordinate.
- Version tags propagate through svcconfig and S2S contracts so that services explicitly target a version.

---

## LDD-31 — Deployment & Runtime Architecture

- Deployment rules:
  - Dev/local can run HTTP on loopback,
  - Staging/prod must be HTTPS with redirect from HTTP to 308,
  - FORCE_HTTPS flag enforced in upper envs.
- Each service declares ports and slugs via env-service/svcconfig, not local config.
- Rolling deploys must respect health checks; no traffic should go to unhealthy instances.

---

## LDD-32 — Observability & Telemetry Architecture

- Observability includes logs, metrics, traces, and health endpoints.
- Metrics: request rate, latency, error rate, DB ops, S2S call metrics, WAL throughput.
- Traces tie multi-service calls via requestId; SvcClient is the primary propagation point.
- Health endpoints expose minimal but sufficient info for load balancers and orchestrators.

---

## LDD-33 — Security & Hardening Architecture

- Core principles:
  - Least privilege everywhere (DB, S2S, Auth),
  - Gateway as only public door,
  - Workers bound to local/private networks.
- Sensitive data (tokens, passwords, secrets) never logged.
- Rate-limits, auth, and S2S guardrails are part of hardening, not optional add-ons.

---

## LDD-34 — Shared S2S Gate & Authorization Flow

- Shared S2S gate is the canonical middleware for worker services:
  - Health is always open,
  - All other protected routes must pass verifyS2S before hitting body parsers and pipelines.
- S2S verification checks:
  - Token validity (issuer/audience),
  - Caller identity and allowed call graph,
  - Required headers present.
- On failure, S2S gate emits standardized Problem+JSON errors with guidance for Ops.
- This LDD ties together LDD-12 (SvcClient), LDD-19 (S2S protocol), and LDD-33 (security) into a concrete flow.

---

**End of LDD Working Compression.**

# ideas-and-features.md (Compression)

This doc represents the evolving user-facing + UX + engagement feature set.

---

## Abbreviations

- GF (geofence)
- TBT
- WPA
- - (MVP)
- # (future)

---

## APP DISPLAY

### Display Constraints

- Portrait only (MVP)
- Three regions: Dashboard, Content, Footer
- Desktop = centered mobile portrait

---

## DASHBOARD

### Dashboard Variants

1. Anonymous user
2. Signed-in w/ GF on
3. Signed-in w/ GF off

### Dashboard Elements (MVP + Future)

- Global active users
- County active users
- Live events near user
- Credit balance (tachometer)
- Remaining credits for fee offset
- Venue count (if inside venue)
- Mail icon w/ unread
- GF trip counter
- # Newsfeed marquee
- Reliability score
- # Dashboard skins & animation

### Hamburger Menu

- Add Event
- Invite
- Acts
- Places
- Users
- Settings
- About
- Contact
- FAQs

---

## USERS

### 1. Anonymous Users (MVP)

- No login required
- Ads shown
- Limited filters
- No GF
- No credits
- Menu disabled

### 2. Viber (signed-in)

- No fee
- Ads in footer only
- Earn credits
- Join groups (but not create)
- GF enabled

### 3. Prem Viber

- Full functionality
- No ads
- Credits can offset fees
- Can become lifetime free
- Reliability index initialized to zero
- Invite system w/ credit rewards

---

## PLACES (Venues)

- Must exist before Events
- Employees can be linked
- # Web portal in future

---

## GEOFENCING (GF)

### Core

- Foundational feature
- Requires device location
- Many UI behaviors gated on GF
- GF trips are persisted (eventId, timestamp, optional userId)

### Aggregation

- Monthly + lifetime trip counts

### UX

- # Splash screens per trip
- # Time-in-venue tracking
- # Travel notifications
- # Badges, credits
- # Group attendance notifications
- # Act → attendee messaging
- # Attendee → act messages
- # Merch credits

---

## CREDITS

### Earning Credits

- Engagement time
- UI clicks
- Invites accepted
- Act added → event created
- GF trips
- Group GF bonus
- Verifications
- Doubts
- Photo adds & votes

### Credit Lifecycle

- Each credit logged as a record
- Batched send
- 60-day lifespan (rounded up)
- Can offset subscription fees
- Can gift to Acts

### Credit Economics

- Dollar value floats with revenue
- Users cannot redeem for cash

---

## CROWD SOURCING (Data Reliability)

### Seedable Entities

- Acts
- Places
- Events

### Reliability System

- Data starts as “not verified”
- Buttons: Verify / Doubt
- Scores: +1 / -1 / thresholds
- Auto-hide with low score
- Act members can auto-verify
- Reliability rewards/punishments
- Profanity & tone filtering

---

## DATA VIEWING

### Purpose

- Show events that matter to user

### Display Modes

- List
- Map

### Radius Rules

- Default 5 miles
- Prem Vibers can change radius
- Act/Place selector overrides radius

### Filters

- Event type
- Subtype
- Act
- Place

### Event Cards

- RSVP system with reliability influence

---

## MESSAGING

### Channels

1. Push notifications
2. DM (user ↔ user, groups WPA)
3. Footer messages
4. Dashboard marquee

### Message List View

- 30-day retention
- Bold unread
- Popup detail

---

## CREDIT GIFTING

- Used to:

  1. Pay subscription
  2. Gift Acts

- Lifetime rules for credits
- Monthly payout to Acts (TBT provider)

---

## MILESTONES

- Achievements displayed
- Act ranking (top 5 gifting)
- Dashboard marquee announcements

---

## STARTUP PLAN

- Region scraping (Burbank first)
- Parallel scraping + MVP dev
- Venue sponsorship pre-launch
- Prem Lite for early adopters
- Early users can earn lifetime Prem
- Act onboarding after scraping phase

** IMPORTANT **

## Proactively tell me when it's time to start a new session.

## Proactively suggest alternatives and better ways to solve problems if you disagree with my approach.

## If, when building code you're unsure of an object or module's interface, ask for a code drop rather than guess on a function or approach.

## Don't want to see the extention 'Like' in any of the code.

## All ADR are created as .md files with a download link - always.

## For the 1st ADR in a session, ask for the ADR number to use.

## No unfinished code

When writing code for NV backend:

No forward-looking TODO promises.

No passive “can be wired later.”

No comments implying skipped invariants.

Every invariant is either enforced in code or explicitly failed.
