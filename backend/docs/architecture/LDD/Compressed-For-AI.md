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
