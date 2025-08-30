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

✅ End of SOP Addendum1

Addundum 2 - security and authorization

SOP Addendum — Uniform Service-to-Service (S2S) Authorization
Scope

Applies to all internal worker services (geo, act, place, log, etc.), the gateway (external), and gateway-core (internal). Establishes one way to authenticate and authorize every internal call. Health endpoints stay open.

The Rule (non-negotiable)

Only the gateway is externally reachable. The gateway-core has no external visibility.

Every non-health request to a worker must carry a valid S2S JWT minted by a trusted issuer (the gateway or gateway-core).

gateway-core always injects S2S to workers when proxying; never forward user tokens internally.

Health endpoints (/health, /healthz, /readyz) remain open, constant-time, no fan-out.

Token Format (now) & Upgrade Path

Algo (now): HS256 (shared secret).

Claims (required):

iss: one of gateway or gateway-core

aud: internal-services

exp (≤ 60s), iat

svc: caller identity (e.g., gateway, gateway-core, act)

Optional (authZ): perm (e.g., geocode:resolve).

Upgrade (later for money flows): switch to RS256/ES256 + JWKS with kid rotation.

Required Env (standardize names)

Minting services (gateway & gateway-core):

S2S_JWT_SECRET=devlocal-core-internal
S2S_JWT_ISSUER=gateway # on the external gateway
S2S_JWT_AUDIENCE=internal-services
S2S_TOKEN_TTL_SEC=60

(On gateway-core, S2S_JWT_ISSUER=gateway-core.)

Workers (verify S2S):

S2S_JWT_SECRET=devlocal-core-internal
S2S_JWT_AUDIENCE=internal-services
S2S_ALLOWED_ISSUERS=gateway,gateway-core

# Optional hardening per worker:

S2S_ALLOWED_CALLERS=gateway,gateway-core,act
REQUIRE_PERMISSIONS=false

Responsibilities
Gateway (external)

Validates user auth (out of scope here).

When calling a worker directly, mint S2S and set Authorization: Bearer <S2S>.

gateway-core (internal)

Proxies /api/<svc>/<rest> only; no external exposure.

Always overwrite outbound Authorization with a fresh S2S token; do not forward user tokens.

Per-caller rate limits and audit logging.

Signer

// src/utils/s2s.ts (in gateway-core)
import jwt from "jsonwebtoken";
export function mintS2SToken(caller="gateway-core", ttl=+process.env.S2S_TOKEN_TTL_SEC!||60){
const now = Math.floor(Date.now()/1000);
return jwt.sign(
{ sub:"s2s", iss:process.env.S2S_JWT_ISSUER!, aud:process.env.S2S_JWT_AUDIENCE!,
iat:now, exp:now+ttl, svc:caller },
process.env.S2S_JWT_SECRET!, { algorithm:"HS256", noTimestamp:true }
);
}

Proxy injection

// before proxy.web(...)
import { mintS2SToken } from "../utils/s2s";
req.headers.authorization = `Bearer ${mintS2SToken("gateway-core")}`;
req.headers["x-s2s-caller"] = "gateway-core";

Workers (all internal services)

Mount health first (open), then require S2S for everything else.

// app.ts (worker)
import { createHealthRouter } from "../../shared/health";
import { verifyS2S } from "../../shared/middleware/verifyS2S";

app.use(createHealthRouter({ service: "geo" })); // open
app.use(verifyS2S); // protect the rest

Shared verifier

// shared/middleware/verifyS2S.ts
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
const AUD = process.env.S2S_JWT_AUDIENCE || "internal-services";
const ISS = (process.env.S2S_ALLOWED_ISSUERS||"").split(",").map(s=>s.trim()).filter(Boolean);
const CALLERS = (process.env.S2S_ALLOWED_CALLERS||"").split(",").map(s=>s.trim()).filter(Boolean);
const OPEN = new Set(["/","/health","/healthz","/readyz"]);

export function verifyS2S(req:Request,res:Response,next:NextFunction){
if (OPEN.has(req.path)) return next();
const raw = req.headers.authorization||"";
const tok = raw.startsWith("Bearer ")?raw.slice(7):"";
if(!tok) return res.status(401).json({code:"UNAUTHORIZED",status:401,message:"Missing token"});
try{
const p = jwt.verify(tok, process.env.S2S_JWT_SECRET!, { audience: AUD }) as any;
if(!ISS.includes(p.iss)) return res.status(401).json({code:"UNAUTHORIZED",status:401,message:"Bad issuer"});
if(CALLERS.length && !CALLERS.includes(p.svc))
return res.status(403).json({code:"FORBIDDEN",status:403,message:"Caller not allowed"});
(req as any).s2s = p; next();
}catch{ return res.status(401).json({code:"UNAUTHORIZED",status:401,message:"Invalid signature"}); }
}

Operational Guardrails

Exposure: only the gateway has public ports. gateway-core is internal-only. Workers have no public ports.

Paid APIs: egress via fixed NAT; lock provider keys to that IP; quotas + circuit breaker.

Rate limit: by s2s.svc at gateway-core and workers.

Audit: deny logs (no token/bad issuer/caller) with reqId, svc, endpoint, remote addr; alert on spikes.

Secrets: .env for dev; secrets manager + rotation for prod.

Tests (every worker)

401 on missing/wrong/expired token; wrong aud; bad iss.

403 when S2S_ALLOWED_CALLERS is set and caller not allowed.

Happy path with valid S2S from gateway-core or gateway.

Migration Plan

Add verifyS2S to all workers (after health).

Enable S2S injection in gateway-core proxy.

Set envs: S2S_ALLOWED_ISSUERS=gateway,gateway-core and per-service S2S_ALLOWED_CALLERS.

Verify: direct worker calls fail (401/403); via gateway-core succeed (or return provider errors).

Lock provider keys to egress IP.

Bottom line: Only the gateway is public. gateway-core is internal-only. Workers refuse non-health calls without a short-lived, gateway-minted S2S token.
✅ End of SOP Addendum 2

Addenum 3
SOP Addendum — Dev HTTP Exception (Gateway)

Purpose: Allow plain HTTP only in dev without weakening prod.

Policy

Dev/local: HTTP is allowed. Bind the gateway to 127.0.0.1. No HSTS. No redirect.

Staging/Prod: HTTPS only. HSTS on. HTTP requests 308→HTTPS.

gateway-core & workers: remain internal-only; unaffected.

Env (copy/paste)

# dev

GATEWAY_PORT=4010
GATEWAY_BIND_ADDR=127.0.0.1
FORCE_HTTPS=false

# prod

GATEWAY_PORT=443
GATEWAY_BIND_ADDR=0.0.0.0
FORCE_HTTPS=true

Gateway wiring (tiny)
// bootstrap listen
const PORT = +process.env.GATEWAY_PORT!;
const BIND = process.env.GATEWAY_BIND_ADDR || "127.0.0.1";
server.listen(PORT, BIND);

// redirect middleware (enforce only when FORCE_HTTPS=true)
app.set("trust proxy", true);
app.use((req, res, next) => {
if (process.env.FORCE_HTTPS !== "true") return next();
const xf = String(req.headers["x-forwarded-proto"] || "");
if (req.secure || xf === "https") return next();
return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
});

Quick checks

Dev: curl -I http://127.0.0.1:4010/healthz → 200 OK (no redirect).

Prod: curl -I http://<prod-host>/healthz → 308 Permanent Redirect to https://….

That’s it: HTTP for dev convenience, HTTPS everywhere that matters.

✅ End of SOP Addendum 3

We now have gateway-core.
I want to build Geo-Service, that takes a mailing address and returns a lat and long.
We will use the Google api for this. You will need to provide guidance on getting setup with google, and building the code for the service. The service will our SOP, based on the Act service, but with No DB integration.
In the future this service can use a different 3rd party provider based on env configuration to determine provider at runtime.

Once the Geo-service is complete, we integrate it into the stub that was built within the Act service, for determining an Act's geoLocation based on a provided mailing address.
