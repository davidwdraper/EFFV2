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
