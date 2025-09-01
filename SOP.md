NowVibin Backend — New-Session SOP (Template-style + Shared Test Harness) — v4 (Amended)
Prime Directives

Never overwrite unseen work. If a file exists, paste the full file with repo path before edits. No guessing, no splicing.

Single-concern source files. Shared logic only in services/shared.

Full file drops only. No fragments. No “Option A / Option B.” Decide and deliver.

No barrels, no shims.

Env names only. Values come from env files (.env.dev, .env.test, .env.docker, etc.).

Routes are one-liners. No logic in routes; import handlers only.

Controllers are thin. Validate → parse DTO → repo → return domain. Push audit events to req.audit[].

Instrumentation everywhere. Pino for structured logs; audit all mutations; log entry/exit with requestId.

Global error middleware. All errors flow through problem.ts + error sink.

Audit-ready. Explicit env validation, consistent logging, no silent fallbacks.

Canonical source of truth: Zod contract in services/shared/contracts/<entity>.contract.ts. Everything else adapts to it.

Route Convention (NEW — No Exceptions)

All service routes follow:

http(s)://<hostname><port>/api/<serverName>/<rest>

Health endpoints follow:

http(s)://<hostname><port>/<healthRoute>

<serverName> is always used to resolve environment-specific configuration for the target service.

No exceptions. Gateway, gateway-core, workers — all adhere to this pattern.

Template Service Directive

Act refactor is complete. All new services are cloned from the Template Service (which mirrors Act 1:1).

Pipeline:

Contract (canonical truth)

services/shared/contracts/<entity>.contract.ts

Zod schema + z.infer type.

DTOs

<svc>/src/validators/<entity>.dto.ts

Derived with .pick() / .omit() / .partial().

Mappers

<svc>/src/mappers/<entity>.mapper.ts

domainToDb() + dbToDomain().

Model

<svc>/src/models/<entity>.model.ts

Persistence only. bufferCommands=false, indexes defined.

Repo

<svc>/src/repos/<entity>Repo.ts

Returns domain objects only (no raw DB docs).

Controllers

Validate params → parse DTO → call repo → return domain.

Push audits → req.audit[].

Routes

<svc>/src/routes/<entity>.routes.ts

One-liners that import handlers only.

Logging & Audit

All via shared logger util.

Debug logs on entry/exit with requestId.

Global error middleware emits errors via error sink.

Safe Field Addition SOP

Add to contract.

Update DTOs if exposed via API.

Adjust mappers.

Update model (indexes/required).

Add/adjust 2 tests: mapper round-trip + one controller.
→ Done. No ripple edits.

Testing Expectations

Mapper unit tests: domain ↔ DB.

Controller HTTP tests: 200/201/400/404.

Repo CRUD with ephemeral Mongo.

Coverage ≥70% during triage; restore ≥90% before merge.

Tests must pass direct (service port) and via gateway (/api/<svc>/...).

Session-Start Ritual

Paste this SOP.

State which service we’re working on (Template-spawned service name).

Paste full current files (with repo path headers).

I return full drops (merged, no options, no splicing).

Quick Sanity Checklist

No logic in routes.

Required envs asserted.

bufferCommands=false; indexes present.

RequestId logging on all handlers (enter/exit).

Audit events flushed once.

.env.test present.

Tests green via gateway and direct.

Coverage ≥90% across all metrics.

Seeds idempotent + descriptive.

No barrels. No shims.

Only shared contracts define shared shapes.

Addendum 1 — Logging & Audit

Channels: LogSvc (DB sink), FS (NDJSON fallback), Pino (telemetry), Notify (stub).

Fire-and-forget; requests never block on logging.

FS rotation/limits: ≤LOG_CACHE_MAX_MB, ≤LOG_CACHE_MAX_DAYS. Flush on LogSvc recovery.

Prod errors: LogSvc only; Pino info/debug discarded unless explicitly enabled.

Audit middleware flushes once per request.

Addendum 2 — Security & S2S Authorization

Only gateway is public. Gateway-core is internal.

Every non-health worker call requires a valid S2S JWT minted by gateway/gateway-core.

Workers mount health first, then verifyS2S.

Gateway-core always overwrites outbound Authorization with a new S2S token.

Env keys: S2S_JWT_SECRET, S2S_JWT_ISSUER, S2S_JWT_AUDIENCE, S2S_ALLOWED_ISSUERS, etc.

Tests: 401/403 on bad/missing tokens, happy path with valid S2S.

Addendum 3 — Dev HTTP Exception (Gateway)

Dev/local: HTTP allowed, bound to 127.0.0.1.

Staging/prod: HTTPS only; HSTS enforced; HTTP 308 → HTTPS.

Env keys:

FORCE_HTTPS (false in dev, true in prod).

GATEWAY_BIND_ADDR (127.0.0.1 dev, 0.0.0.0 prod).

Where We Left Off

Template Service is the blueprint.

Act is complete; do not reopen except for Safe Field Addition SOP.

All new services spawn from Template and follow Route Convention strictly.

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
