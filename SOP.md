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

Route & Slug Standard (NowVibin)
Service Slugs

Always singular.

Match the service folder name and the slug field in svcconfig.

Examples:

user → backend/services/user

act → backend/services/act

place → backend/services/place

event → backend/services/event

REST Resource Paths

Always plural for collections.

Exposed by the service itself under /api.

Examples:

GET /api/users → list users

POST /api/acts → create act

GET /api/places/:id → fetch a place

PUT /api/events/:id → update event

Gateway Proxy Convention

External path format:

/api/<slug>/<resource...>

Gateway strips the <slug>, then proxies the remainder to the service’s base URL from svcconfig.

Example flow:

Client: PUT /api/act/acts/123
Gateway: slug=act → baseUrl=http://127.0.0.1:4002
target=http://127.0.0.1:4002/api/acts/123
Service: handles PUT /api/acts/:id

Key Rule of Thumb

Slug = singular = service identity

Resource = plural = REST collection

SOP.md addendum
Gateway Timeouts

Purpose: Prevent hung upstreams from consuming gateway resources.

Env contract: gatewayMs passed to middleware; configured per environment.

Behavior:

If no response within gatewayMs, send 504 and log via SECURITY (reason=deadline_exceeded).

Timer is cleared on both finish and close.

Only fires if no headers sent.

Placement: Mount before auditCapture, alongside other guardrails.

Audit split: Timeout denials log SECURITY, not WAL audit.

Logging Middleware (pino-http)

Purpose: Provides operational telemetry, not billing or guardrail security logs.

Placement: Mount early in app.ts after requestIdMiddleware.

Behavior:

Propagates or generates x-request-id for traceability.

Severity mapping: 2xx/3xx=info, 4xx=warn, 5xx/error=error.

Sanitizes URLs; excludes noisy endpoints (health, favicon).

Bound to serviceName child logger for attribution.

Audit separation: Audit WAL is billing-grade; SecurityLog is for guardrail denials; pino-http is for runtime ops telemetry.

Upstream Identity Injection

Every proxied request must include two tokens:

S2S token minted by the gateway (mintS2S), always overwriting any inbound Authorization.

User assertion (X-NV-User-Assertion) minted if missing, containing the end-user sub, iss, aud, and expiry.

Never forward client tokens upstream. The gateway is the trust boundary.

Env contract: USER_ASSERTION_SECRET, USER_ASSERTION_ISSUER, and USER_ASSERTION_AUDIENCE are required; startup must fail if missing.

Placement: Mount injectUpstreamIdentity under /api before serviceProxy.

Failure behavior: If identity minting fails, reject the request; never proxy without S2S+user identity.

Client Auth Gate + Security Telemetry

Guardrails log to SECURITY channel: authGate, rateLimit, timeouts, and circuitBreaker must call logSecurity(req, {...}) on every deny decision (and selective allow decisions such as bypass). These entries are not billable and must never enter the audit WAL.

Misconfig vs client error: Return 503 for CLIENT*AUTH*\* misconfiguration; return 401/403 for client mistakes. Always include a short, non-PII reason in the security log.

Auth policy: Public prefixes and protected GET prefixes are configured via env; CLIENT_AUTH_REQUIRE=true enforces auth except for declared public paths and HEAD/GET not listed as protected.

Read-only mode: When READ_ONLY_MODE=true, block mutations (except READ_ONLY_EXEMPT_PREFIXES) with 503 and log to SECURITY with reason=read_only_mode.

Audit split: Only requests that pass guardrails are captured by auditCapture and written to the WAL for billing/analytics. Guardrail denials never hit the WAL.

5xx Trace Middleware

Purpose: Pinpoint where a 5xx status was first set in the response lifecycle.

Behavior: Shims res.status, res.sendStatus, and res.writeHead to log a compact, repo-local stack when a 5xx is first assigned. Emits a summary on finish if the status is 5xx.

Signal: Logs carry sentinel <<<500DBG>>> with rid, method, url, phase, and code.

Placement: Mount before guardrails and proxy (e.g., “early” tag). Optionally mount a second instance later (e.g., “late”) if you need finer attribution.

Scope: Observability-only. Does not alter control flow or response bodies.

Gateway App Assembly (Order Must Not Change)

Transport & Telemetry: httpsOnly → cors → requestIdMiddleware → loggingMiddleware → problemJsonMiddleware → trace5xx("early")

Health: Public health & readiness (no auth, no audit).

Guardrails (SECURITY logs on denials): rateLimit, sensitiveLimiter, timeouts, circuitBreaker, authGate.

Billing Audit: initWalFromEnv then auditCapture (only passed requests).

Proxy Plane: injectUpstreamIdentity (S2S + user assertion) → serviceProxy.

Tails: Body parsers for non-proxied routes → notFoundHandler → errorHandler.

Never add business logic to app.ts or routes. Only mount middleware/handlers.
Guardrail denials are SECURITY telemetry only (not billable). Audit WAL is for passed requests.

Config Contracts (Do Not Drift)

rateLimitCfg must expose { points, windowMs } and is sourced from RATE_LIMIT_POINTS, RATE_LIMIT_WINDOW_MS.

timeoutCfg must expose { gatewayMs } from TIMEOUT_GATEWAY_MS.

breakerCfg must expose { failureThreshold, halfOpenAfterMs, minRttMs } from BREAKER\_\*.

If a middleware type changes, update config.ts in the same PR. No interim aliases.

Audit WAL Env Contract (Gateway)

WAL: WAL_DIR, WAL_FILE_MAX_MB, WAL_RETENTION_DAYS, WAL_RING_MAX_EVENTS, WAL_BATCH_SIZE, WAL_FLUSH_MS, WAL_MAX_RETRY_MS, WAL_DROP_AFTER_MB.

Target: AUDIT_TARGET_SLUG, AUDIT_TARGET_PATH (batch PUT endpoint). Optionally AUDIT_TARGET_BASEURL to override svcconfig in dev.

Do not block foreground traffic on WAL errors. Rotate/retry/replay; drop only beyond caps with WARN.

Exactly-once at domain is achieved downstream via eventId dedupe; gateway provides at-least-once with idempotent batches.

Service Resolution

resolvePublicBase(slug) → requires {enabled:true, allowProxy:true}. Used only by public proxy.

resolveInternalBase(slug) → requires {enabled:true}. Used for internal S2S (audit/log/etc.).

Resolution order: local svcconfig mirror → in-memory cache → dev ENV overrides → optional fetch from gateway-core (GATEWAY_CORE_BASE_URL + SVCCONFIG_INTERNAL_PATH) to pre-warm.

Never couple internal S2S to allowProxy. Internal workers may be non-public by design.

Audit Event meta discipline

meta MUST be a Record<string,string>; serialize all values to strings.

Extras like callerIp, userId, component tags (s2sCaller) belong in meta.

Never add fields to the top-level event shape outside the shared contract.

File level documentation:

- Standard for all future file drops:
- Top-level doc block referencing design/ADR docs + rich “why” inline commentary so the next engineer understands the reasoning, not just the syntax.

A few things moving forward:

1. path/filename as a comment at the top of each file is required
2. If an ADR is required in the source file, ask for the next # before generating code and place a proper reference in the comment header. Remember the ADR number and increment for each ADR needed throughout the session.
3. Provide the ADR insertion script with full details, immediately after the code block
