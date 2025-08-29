NowVibin Backend — New-Session SOP (Act-style + shared test harness) — v4

Paste this at the start of each session. It keeps all services identical, audit-ready, and test harnesses consistent.

Prime Directives

Never overwrite unseen work. If a file already exists, you must paste the full, current file (with repo path in the first line) before I make changes. No guessing, no partials.

State-of-the-art, fast, scalable, audit-ready.

Single-concern source files; shared logic in services/shared.

Full file drops only. No fragments, no inline edits.

You never give me options. No "Option A / Option B". Decide and deliver.

All services mirror Act structure 1:1.

Routes = one-liners. No logic in routes.

No large controller files. Routes import individual handlers located at src/controllers/<service name>/handlers/...

No baked values. Env names only; values come from env files.

Instrumentation everywhere (pino / pino-http).

Audit all mutations. Controllers push → req.audit[], flushed once.

try/catch everywhere that matters. asyncHandler + global error middleware.

Audit-ready: explicit env validation, consistent logging, no silent fallbacks.

Every file begins with repo path in a // comment.

Dev bootstrap may default ENV_FILE to .env.dev; prod must set explicitly.

No shims. If a contract/type isn’t ready, we build the real one in shared.

No barrels. No index.ts re-exports, no export \*. Always import directly.

Canonical Service Layout (Act-style)

(unchanged; omitted here for brevity — still the Act template with scripts, src, test, etc.)

Environment Policy

(unchanged)

Bootstrap & Index

(unchanged)

Logging & Audit

(unchanged)

Performance / Ops Notes

(unchanged)

Test Harness

(unchanged)

Import Discipline (No Barrels)

(unchanged)

Contracts (No Shims)

(unchanged)

Where We Left Off (Act)

(unchanged — still timestamps bug and repo fixes)

Session-start Ritual

Paste this SOP.

Say which service we’re on.

Paste existing files I must merge (full, with repo path).

I deliver full drops, no options.

Quick Sanity Checklist

No logic in routes.

Required envs asserted.

bufferCommands=false; indexes in models.

Request-ID logging.

Audit events flushed.

.env.test present.

Tests green via gateway (4000) + direct (4002).

Coverage ≥90% all metrics.

Seeds idempotent + descriptive.

No shims; no barrels.

Only shared contracts for shared shapes.

All existing files pasted in full before modification.

End SOP v4

# NowVibin Logging & Audit SOP (Authoritative)

## Purpose

Consistent, auditable logging across all services. Fire-and-forget. Filesystem is a **cache**, not the final sink.

## Channels

- **LogSvc** – Log microservice (DB sink)
- **FS** – Append-only NDJSON cache (fallback only)
- **Pino** – Structured stdout (runtime telemetry)
- **Notify** – Stubbed notification (prod only, after grace period)

## Environment Variables

- `NODE_ENV` = `development` | `test` | `production`
- `LOG_LEVEL` (pino required)
- `LOG_SERVICE_URL`, `LOG_SERVICE_TOKEN_CURRENT`
- `LOG_FS_DIR` (required)
- `LOG_PING_INTERVAL_MS` (e.g., 15000)
- `LOG_BREAKER_COOLDOWN_MS` (e.g., 30000)
- `LOG_FLUSH_BATCH_SIZE` (e.g., 50)
- `LOG_FLUSH_CONCURRENCY` (e.g., 4)
- `LOG_CACHE_MAX_MB` (e.g., 256)
- `LOG_CACHE_MAX_DAYS` (e.g., 7)
- `LOG_ENABLE_INFO_DEBUG` (`"true"` enables Pino info/debug in prod)
- `NOTIFY_STUB_ENABLED` (`"true"` enables stub in prod)
- `NOTIFY_GRACE_MS` (how long LogSvc must remain down before stub fires, e.g., 300000)

## Routing Matrix

| Case           | dev / test                                    | production                                                                                  |
| -------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **AUDIT**      | LogSvc; on failure → **FS + Pino**            | LogSvc; on failure → **FS**, and **Notify(stub)** only if down ≥ `NOTIFY_GRACE_MS`          |
| **ERROR**      | **LogSvc + Pino**; on failure → **FS + Pino** | **LogSvc only**; on failure → **FS**, and **Notify(stub)** only if down ≥ `NOTIFY_GRACE_MS` |
| **INFO/DEBUG** | **Pino**                                      | **Discard** unless `LOG_ENABLE_INFO_DEBUG=true` → Pino                                      |

All emissions are **fire-and-forget**. No retries that block the request path.

## FS Cache (Fallback) Rules

- **Format**: NDJSON (one JSON object per line).  
  Fields: `v`, `channel`, `eventId`, `timeCreated`, `service`, `level`, `payload`, `sourceFile`, `sourceLine`, `sourceFunction`, `requestId`, `userId`, `retry`.
- **Filenames**:
  - `audit-YYYY-MM-DD.log`
  - `error-YYYY-MM-DD.log`
- **Rotation/limits**: total size ≤ `LOG_CACHE_MAX_MB`, age ≤ `LOG_CACHE_MAX_DAYS`.  
  On exceed, drop **oldest** files first and bump a drop counter.
- **Flush**: when LogSvc deep-ping succeeds, stream `.replay` files and re-emit to LogSvc in batches. Keep failed lines; delete empty `.replay`. Never block requests.
- **Circuit breaker**: when LogSvc call fails, open breaker. Deep-ping at most every `LOG_PING_INTERVAL_MS`. On success, close breaker and trigger flush.

## Notification Stub (prod only)

- Only enabled if `NOTIFY_STUB_ENABLED=true`.
- Fires **only if** LogSvc has been down continuously for at least `NOTIFY_GRACE_MS`.
- Emits one WARN per outage window (`NOTIFY_STUB: audit fallback` / `error fallback`), then backs off until breaker closes or grace lapses. No external calls yet.

## Event Shapes

- **Audit**:  
  `{ type, entity, entityId, message?, data?, requestId?, userId?, service, sourceFile, sourceLine, sourceFunction, timeCreated }`
- **Error**:  
  `{ code?, message, err?, requestId?, service, sourceFile, sourceLine, sourceFunction, path?, method?, status? }`
- **Telemetry**:  
  `{ level, message, meta?, requestId?, service }`

All events include `service`. **Audit/Error** always include caller metadata from `logMeta`.

## Usage Guidelines

### Controllers & Business Events

- ✅ Push business actions to `req.audit[]` during the request.
- ✅ Rely on shared audit middleware to flush via `auditSink.emit(req.audit)`.
- ❌ Don’t call LogSvc directly from controllers.

### Errors

- ✅ Let the global error middleware emit via `errorSink.emit(...)`.
- ❌ Don’t scatter `logger.error` in handlers unless also returning an error response.

### Telemetry

- ✅ Use info/debug sparingly. Goes to Pino (discarded in prod unless enabled).
- ❌ Never log secrets; redaction is on, but don’t tempt fate.

### Process Level

- ✅ Trap `unhandledRejection` / `uncaughtException` once in `index.ts`.
- ✅ Emit via error sink (not raw logger).
- ✅ Exit process after logging if appropriate.

### NEVER

- ❌ Bypass the shared logger utilities.
- ❌ Write arbitrary files under `LOG_FS_DIR`.
- ❌ Emit the same error twice.
- ❌ Leave “temporary” console logs in production code.

## Acceptance Tests (per service)

- LogSvc healthy: audit/error reach LogSvc; **no FS growth**.
- LogSvc down: audit/error write to FS; in dev/test also see Pino; after deep-ping success, FS **flushes**.
- Prod: error not printed to Pino; info/debug discarded unless flag enabled.
- Notification stub: fires only after `NOTIFY_GRACE_MS` continuous outage; one WARN per outage.

## Operational Guardrails

- Ensure `LOG_FS_DIR` exists and is writable at boot; fail fast if missing.
- Monitor disk usage; alert at ≥80%.
- Surface metrics: breaker open time, FS append count, flush success/fail, dropped lines.

We start back at the Act service where we need to refactor to make the Zod schema the source of truth.
Also ensure that all audits and logging use the new refactored logger util.
Make sure that every route has debug entry/exit logging.

Not sure if I'm repeating this:

Prime Directive

One canonical source of truth per entity.
Everything else adapts to it. No duplication, no parallel definitions.

⸻

Data Normalization Pattern
    •    Canonical Contract:
Zod schema in backend/services/shared/contracts/<entity>.contract.ts
→ Export z.infer type as the single truth.
    •    DTOs:
Located in <svc>/src/validators/<entity>.dto.ts using .omit(), .pick(), .partial().
    •    Mappers:
In <svc>/src/mappers/<entity>.mapper.ts for domain ↔ DB conversion.
Functions: domainToDb(entity) and dbToDomain(doc).
    •    Model:
In <svc>/src/models/<entity>.model.ts for persistence only (Mongoose).
    •    Repo:
In <svc>/src/repos/<entity>Repo.ts — always return domain objects via mapper.
    •    Controller:
Validate params → parse body via DTO → call repo → return domain.
No business logic, no shortcuts.
    •    Error/Logging:
Shared problem.ts, asyncHandler.ts, logger.ts.
Every controller logs entry/exit with request ID.

⸻

Service File Layout (inline)
    •    backend/services//src/controllers
    •    backend/services//src/repos
    •    backend/services//src/models
    •    backend/services//src/mappers
    •    backend/services//src/validators
    •    backend/services/shared/contracts
    •    backend/services/shared/utils

⸻

Safe Field Addition SOP
    1.    Add to shared/contracts/<entity>.contract.ts.
    2.    Update DTOs if exposed to API.
    3.    Adjust mappers.
    4.    Update Mongoose model if required (index/required).
    5.    Add/adjust 2 tests (mapper round-trip + one controller).
→ Done. No ripple edits.

⸻

Testing Expectations
    •    Mapper unit tests: domain ↔ DB.
    •    Controller HTTP tests: 200/201/400/404.
    •    Repo tests: CRUD with ephemeral Mongo.
    •    70% coverage during triage; restore to 90%+ once green.

⸻

Pre-Release Rule: No Workarounds
    •    No barrels (index.ts re-exports).
    •    No shims/ad-hoc glue.
    •    No brittle overrides.
    •    No “just for now” hacks.
If it feels like a shim, the blueprint is wrong — fix the seam, don’t patch it.

V2 Rule: Performance shortcuts and convenience exports can be revisited post-MVP. Never before.

⸻

Hack Audit Rule
    •    Before release, identify and remove all hacks:
    •    Barrel exports under /src/index.ts.
    •    Hand-rolled type casts or any.
    •    One-off JSON responses not using problem.ts.
    •    Controllers with hidden repo/DB logic.
    •    Temporary flags or code marked with TODO/FIXME.
    •    Every service passes an audit sweep:
    •    Folder tree matches blueprint.
    •    No orphan files.
    •    No “helpers” that duplicate shared utils.

⸻

Cookie-Cutter Rule

Every new service copies this exact blueprint.
Contract → DTO → Mapper → Model → Repo → Controller.
Nothing else. Consistency = speed.

⸻

Gateway service has been refactored to be generic, using 2nd path part to determine service.
All api call should be api/<service>/<rest of path>

gateway and act (both direct and via gateway) are responding to curl health check

✅ End of SOP Addendum

We now have gateway-core.
I want to build Geo-Service, that takes a mailing address and returns a lat and long.
We will use the Google api for this. You will need to provide guidance on getting setup with google, and building the code for the service. The service will our SOP, based on the Act service, but with No DB integration.
In the future this service can use a different 3rd party provider based on env configuration to determine provider at runtime.

Once the Geo-service is complete, we integrate it into the stub that was built within the Act service, for determining an Act's geoLocation based on a provided mailing address.
