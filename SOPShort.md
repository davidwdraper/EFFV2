NowVibin Backend — Core SOP (Reduced, Clean)
Prime Directives

Never overwrite unseen work — always ask for and work from the current file.

Single-concern files — shared logic only in backend/services/shared.

Full file drops only — no fragments, no options.

No barrels or shims.

Env names only — values from .env.dev, .env.test, .env.docker, etc.

Routes are one-liners — import handlers only.

Thin controllers — Validate → DTO → repo → return domain → push audits to req.audit[].

Instrumentation everywhere — pino logs entry/exit with requestId; audit all mutations.

Global error middleware — everything funnels through problem.ts + error sink.

Audit-ready — explicit env validation; no silent fallbacks.

Canonical truth = Zod contract in services/shared/contracts/<entity>.contract.ts.

Route & Service Rules

URL convention (no exceptions)

http(s)://<host>:<port>/api/<slug>/v<major>/<rest>
http(s)://<host>:<port>/<healthRoute>

<slug> = singular service name; REST resources = plural.

CRUD (versioned paths)

Create: PUT /api/<slug>/v1/<resources> (service generates \_id, returns it)

Update: PATCH /api/<slug>/v1/<resources>/:id

Read: GET /api/<slug>/v1/<resources>/:id

Delete: DELETE /api/<slug>/v1/<resources>/:id (idempotent)

No PUT /:id replaces.

Gateway proxy strips <slug> and forwards to service base URL from svcconfig.

Health first — mount health route before any auth/middleware.

Template Service Blueprint

All new services clone Act 1:1.

Flow: contract → DTOs → mappers → model → repo → controllers → routes.

Model: bufferCommands=false; indexes defined.

Repo: returns domain objects only.

Safe Field Addition SOP

Add to contract.

Update DTOs.

Adjust mappers.

Update model (indexes/required).

Add 2 tests: mapper round-trip + controller (minimal).

✅ Do this even if broader test suite is deferred.

Logging & Audit (critical)

Use shared logger util → pino-http; propagate x-request-id.

Audit middleware flushes once per request.

Separate SECURITY logs (guardrail denials) from WAL audit (passed requests).

LogSvc is primary sink; FS NDJSON is fallback.

Security & S2S (critical)

Only gateway is public; workers require valid S2S JWT.

verifyS2S mounted right after health and before body parsers/routes.

Gateway never forwards client Authorization.

Both gateway and workers use shared callBySlug to mint tokens and make internal calls.

Required envs (minimum)

S2S_JWT_SECRET
S2S_JWT_ISSUER
S2S_JWT_AUDIENCE
S2S_ALLOWED_ISSUERS
S2S_ALLOWED_CALLERS

(Recommended) S2S_CLOCK_SKEW_SEC

Deployment & Transport

Dev/local: HTTP allowed on 127.0.0.1.

Staging/prod: HTTPS only; FORCE_HTTPS=true; HTTP → 308.

Session-Start Ritual

Paste this reduced SOP.

State which service is active.

Paste full current files with repo-path headers.

Receive full merged drops — no guessing, no splicing.

File Discipline

Top-of-file comment with path/filename and design/ADR references.

Inline “why” comments, not “how”.

Always ensure new code is wired in — no hanging strays.

Never drift. If you don’t know if pre-existing logic exists, ask first before building.

Always, always, always: first line of every file drop should look like

// backend/services/log/src/app.ts

✅ This version is ready to paste at the start of each new session.

To be dropped for future sessions:

You have saved the NowVibin Backend — Core SOP (Reduced, Clean) as the fresh baseline for all new backend sessions.

plus...
Always ask for files before dropping unless it's a new file.
Always put path/file on first line.
Always put header at top of each file, and reference appropriate docs and ADRs.
Create new ADRs when needed. Provide the ADR prior to writing code.
Ask for the ADR generation script, so you can produce the ADR documentation content.
No god-files. If a file gets even close to 200 lines it needs to be split. Files that are nothing more than worker bees for a parent with no likely reuse, should be grouped together in a sub-folder.
Everything is written as TS classes, using OO best practices. There has to be a good reason to not use a class.
