NowVibin Backend — New-Session SOP (Act-style template + shared test harness)

Paste this at the start of each session. It keeps all services identical, audit-ready, and test harnesses consistent.

Prime Directives

State-of-the-art, fast, scalable, audit-ready.

Single-concern source files; shared logic in services/shared.

Full file drops only. Existing files must be pasted in full.

You never give me options — you decide and deliver.

All services mirror Act structure 1:1.

Routes = one-liners. No logic in routes.

No baked values. Env names only; values come from env files.

Instrumentation everywhere (pino-http).

Audit all mutations. Controllers push → req.audit[], flushed once.

try/catch everywhere that matters. asyncHandler + global error middleware.

Audit-ready: explicit env validation, consistent logging, no silent fallbacks.

Every file begins with repo path in a // comment.

Dev bootstrap may default ENV_FILE to .env.dev; prod must set explicitly.

Canonical Service Layout
backend/services/<svc>/
├─ index.ts
├─ vitest.config.ts
├─ .env.test
├─ src/
│ ├─ bootstrap.ts
│ ├─ app.ts
│ ├─ config.ts
│ ├─ db.ts
│ ├─ routes/
│ ├─ controllers/
│ ├─ models/
│ └─ middleware/
└─ test/
├─ setup.ts
├─ seed/runBeforeEach.ts
├─ utils/http.ts
├─ helpers/
│ ├─ mongo.ts
│ ├─ server.ts
│ └─ factories.ts
├─ unit/
└─ e2e/

Shared
backend/services/shared/
├─ config/env.ts
├─ health.ts
└─ utils/
├─ logger.ts
├─ logMeta.ts
└─ cache.ts

Environment Policy

Dev: ENV_FILE optional; defaults .env.dev.

Prod: ENV_FILE required.

Vars prefixed (ACT_PORT, USER_MONGO_URI, etc.).

No fallbacks for required keys.

Bootstrap & Index

index.ts imports ./src/bootstrap first.

Bootstrap logs env path and asserts required vars.

Logging & Audit

pino for structured logs (entry, exit, error).

postAudit for business events (mutations).

Request ID from headers or randomUUID.

Performance/Operational Notes

mongoose.set("bufferCommands", false).

Indexes defined in models.

Redis caching via cache.ts.

Future: circuit breakers, retries, rate limiting.

Test Harness (standard across services)
Vitest config

Node env, 60s timeouts.

Coverage 90% lines/funcs/branches/stmts.

c8 ignore only on impossible defensive lines.

Deterministic bootstrap (test/setup.ts)

Always set:

NODE_ENV=test

Service vars (USER_SERVICE_NAME, USER_MONGO_URI, USER_PORT, …).

Cutoffs/flags controllers rely on.

Silence pino in tests (stub logger).

Import globals via types: ["vitest/globals"].

Seeding

test/seed/runBeforeEach.ts.

Idempotent bulkWrite, upsert, includes required schema fields (e.g., GeoJSON loc).

Namespaced (UVTEST\_\*).

Logs pre/post counts.

Supertest helpers (test/utils/http.ts)

expectOK, expectCreated wrappers.

Log full Problem+JSON on failure.

Mongo hygiene

Ensure indexes documented.

GeoJSON loc always seeded.

Connection reuse across tests.

Routes & test hooks

Keep /**err-nonfinite, /**audit guarded by NODE_ENV=test.

Use unmatched path for 404 tests.

Coverage playbook

Tick cold branches with micro-specs.

Search “no q” path by tuning cutoff in env.

Lower gates temporarily (<1%) only with TODO + date.

Prefer factories for known-good payloads.

Import/config sanity

Tests import ../src/....

Vitest plugins: vite-tsconfig-paths.

Setup includes seeds and env.

Zod diagnostics

Log response bodies when 400/500 unexpected.

Use factories for tricky payloads.

Flake killers

REDIS_DISABLED=1 in tests.

PORT=0 ephemeral.

Clamp typeahead/list limits in tests.

Assert shapes, not IDs.

“Do nots”

Never seed in app code.

Don’t rely on ordering without explicit sort.

Don’t assert static IDs from seeds.

Where We Left Off

Act coverage: a couple cold branches left (search cutoff, app error handler).

Goal: ≥90% coverage across all.

Use this harness for User service next — rename seeds/env to USER\_\*.

The user service is working, but needs refactoring for redis and a test harness the same as Act. To ensure exact alignment, let's start with index.ts. I will send you the Act version and then the User version. You can merge from act/index.ts to user/index.ts
