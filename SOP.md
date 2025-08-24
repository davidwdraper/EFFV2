<!-- eff/SOP.md -->

NowVibin Backend — New-Session SOP (Act-style template + shared test harness)

This is our rails. Paste this at the start of a new session and we’ll stay consistent across every service.

---

## Prime Directives

- You’re the developer. You want full file drops, not nibbles.
- Existing files? You upload them. I won’t guess. For any pre-existing file, I’ll ask you to paste it so I can merge accurately.
- Don't provide Option A and Option B adivce. As the programmer, you have to make your best decision and provide it. I don't have the experience to make the call.
- Uniform template. Every service mirrors the Act service structure and shared components 1:1.
- Routes are one-liners. Route files only map HTTP → controller method. No logic in routes.
- No hard-coded env values. Code never bakes secrets or config values. Env names are allowed; values come from env files.
- Instrumentation on every endpoint. Entry/exit + errors via pino (pino-http in app.ts).
- Audit on mutations. Any non-idempotent change (create/update/delete/side effects) pushes to req.audit[]; flushed once per request by middleware using our shared postAudit().
- try/catch everywhere that matters. Controllers and bootstraps use structured error handling (via asyncHandler + global error middleware).
- Best practices always. Safe-by-default, deterministic, lint/TS clean, minimal magic.
- Audit-ready. Env validation is explicit, logging is consistent, no silent fallbacks in production.
- Header comment. Every file starts with its full repo path in a single-line comment.
- Dev convenience vs prod strictness. Dev bootstrap may default ENV_FILE to .env.dev; prod must set ENV_FILE explicitly. No value fallbacks for required keys.

---

## Canonical Service Layout (mirror Act)

backend/services/<svc>/
├─ index.ts # boots app (imports ./src/bootstrap first)
├─ vitest.config.ts # per-service test config
├─ .env.test # optional, service-local test overrides
├─ src/
│ ├─ bootstrap.ts # loads ENV_FILE, asserts required envs
│ ├─ app.ts # express app, pino-http, health, routes, errors
│ ├─ config.ts # named exports; no defaults
│ ├─ db.ts # connects to DB, safe logging, fail-fast/retry policy
│ ├─ routes/
│ │ └─ <domain>Routes.ts # one-liners: router.<verb>(path, controller.method)
│ ├─ controllers/
│ │ └─ <domain>Controller.ts # logic/validation; asyncHandler; audit pushes
│ ├─ models/
│ │ └─ <Domain>.ts # mongoose model, default export; strict schema, indexes
│ └─ middleware/ # if needed
└─ test/
├─ setup.ts # loads ENV_FILE (.env.test), hermetic defaults
├─ helpers/
│ ├─ mongo.ts # waitForMongo(), connect/disconnect utils
│ ├─ server.ts # create in-process HTTP server for Supertest
│ └─ factories.ts # data builders (e.g., makeAct())
├─ unit/ # controller/model unit tests
│ └─ <domain>.controller.spec.ts
└─ e2e/ # black-box API tests (via app)
└─ <domain>.e2e.spec.ts

yaml
Copy
Edit

---

## Shared (identical across services)

backend/services/shared/
├─ config/env.ts # loadEnvFromFileOrThrow, assertRequiredEnv
├─ health.ts # createHealthRouter: /health, /healthz, /readyz
└─ utils/
├─ logger.ts # pino instance + postAudit(), extractLogContext()
├─ logMeta.ts # getCallerInfo() helper
└─ cache.ts # cacheGet() and invalidateOnSuccess() middleware (Redis)

yaml
Copy
Edit

---

## Environment Policy

- Dev: ENV_FILE optional; defaults to .env.dev (repo root).
- Prod: ENV_FILE required.
- Use `<SVC>_` prefixes for clarity (e.g., ACT_PORT, ACT_MONGO_URI, ACT_SERVICE_NAME).
- No value fallbacks for required keys. Validation happens in bootstrap and/or config.ts.

---

## Bootstrap & Index Order

- `index.ts` must import `./src/bootstrap` first to initialize logging and env.
- Bootstrap prints the resolved env file path and asserts a service-specific required list.

---

## Logging & Audit Policy

- **pino** for runtime logs: request entry, exit, errors; JSON to stdout.
- **Audit logger (postAudit)** for business events only; controllers push to `req.audit[]`; middleware flushes once on finish.
- Request id: read `x-request-id` / `x-correlation-id` / `x-amzn-trace-id`, else `randomUUID()`. Echo back via header.

---

## Performance/Operational Notes

- **Mongoose:** `mongoose.set("bufferCommands", false)` in services to fail fast.
- **Indexes:** define for search patterns (e.g., 2dsphere for geo, compound for uniqueness).
- **Logging:** structured, no heavy stringification in hot paths.
- **Redis caching (shared cache.ts):** use `cacheGet()` + `invalidateOnSuccess()`.
- **Backpressure:** don’t hold large payloads; stream where possible.
- **Rate limiting:** future-proof surge-sensitive code paths (e.g., typeahead) with caches.
- **Circuit breakers/retries:** wrap upstream clients (to be added once upstreams exist).

---

## Standard Test Harness (applies to all services)

Unifies Vitest + Supertest + Zod, with consistent coverage and Problem+JSON behavior.

### 1. Vitest config (per service)

```ts
// backend/services/<svc>/vitest.config.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["backend/services/<svc>/test/**/*.spec.ts"],
    setupFiles: ["backend/services/<svc>/test/setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "backend/services/<svc>/coverage",
      all: true,
      include: ["backend/services/<svc>/src/**"],
      exclude: ["**/test/**", "backend/services/<svc>/src/index.ts"],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
c8 ignore only for defensive branches, annotated inline with a reason.

2. Test env setup (test/setup.ts)
ts
Copy
Edit
// backend/services/<svc>/test/setup.ts
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.test") });

// Hermetic test defaults (tests only; never in service code)
process.env.REDIS_DISABLED ??= "1";
process.env.NODE_ENV ??= "test";
3. App & DB lifecycle in tests
Load env before imports.

Wait for Mongo readyState (1).

Use ephemeral HTTP server for Supertest.

4. Problem+JSON & Zod
Shared Zod contracts (@shared/contracts).

Use helpers: zodBadRequest, zValidationError, notFound.

Error handler coerces to Problem+JSON.

5. vi.mock conventions
Specifier string must exactly match module import.

Hoist specifier into a const before vi.mock().

6. Patterns tested in every service
Health routes /health, /healthz, /readyz.

404 returns Problem+JSON.

Error handler branches: 422, plain throw, non-finite → coerced.

Pino autoLogging ignore works.

Audit flush tested.

CRUD branches, invalid ID, Zod validation, search branches, date handling.

7. Coverage expectations
90% lines/functions/branches/statements enforced.

Coverage HTML report at backend/services/<svc>/coverage/index.html.

Models included by default.

8. Redis in tests
Disabled by default (REDIS_DISABLED=1).

cacheGet and invalidateOnSuccess no-op.

9. Running tests
bash
Copy
Edit
# Per-service
yarn test:act:unit
yarn test:act:watch
yarn test:act:e2e

# Combined
yarn test:act
Architecture Notes
Gateway = top tier.

Business logic services = mid-tier.

Entity services = bottom tier.

Only log service crosses tiers.

Tokens secure logging; enforced in bootstrap.

Where we left off
We were debugging coverage for Act:

actController.search cutoff branches,

townController typeahead/list/get,

app.ts error handler + pino ignore,

shared cache.ts restored.

Branch coverage still needs targeted specs. Goal: ≥90% with minimal, justified ignores.

Final reminder
Every service identical in shape and behavior.

Never guess file contents — ask for them.

Favor realistic integration tests with Mongo + Supertest.

Mock only explicit edge/error branches.

With this SOP + harness, we stay audit-friendly, investor-grade, and ready to surge without scrambling.


You added this after after completing the act tests:

Add these to the SOP
1) Test bootstrap (make it deterministic)

Always set env up front in test/setup.ts:

NODE_ENV=test

Service vars (USER_SERVICE_NAME, USER_MONGO_URI, USER_PORT, etc.)

Any cutoffs/feature flags the controllers lazily read (e.g., *_SEARCH_UNFILTERED_CUTOFF).

Silence pino in tests: stub logger to avoid noisy/slow output.

Vitest globals: either import { describe, it, expect, beforeAll } from "vitest" in each file, or set "types": ["vitest/globals"] in your test tsconfig.

2) Seeding (never in app code)

Put seeds in test/seed/runBeforeEach.ts loaded via setupFiles.

Seeder must:

Ensure Mongo connected (connect if needed using USER_MONGO_URI).

Upsert idempotently (bulkWrite with $setOnInsert).

Satisfy schema/indexes (e.g., include any required GeoJSON fields).

Log counts once: pre/post, DB name. (So when something’s missing, you know why.)

Keep seeds tiny and namespaced (UVTEST_* for user service).

3) Supertest helpers (catch bad responses instantly)

Drop a tiny helper module in test/utils/http.ts:

// test/utils/http.ts
import type { SuperTest, Test } from "supertest";

export async function expectOK(t: Test) {
  const res = await t;
  if (res.status >= 400) {
    // prints once per failure so you see Zod/Problem+JSON details
    // eslint-disable-next-line no-console
    console.error("[HTTP FAIL]", res.req.method, res.req.path, res.status, res.body);
  }
  expect(res.status).toBe(200);
  return res;
}

export async function expectCreated(t: Test) {
  const res = await t;
  if (res.status >= 400) {
    // eslint-disable-next-line no-console
    console.error("[HTTP FAIL]", res.req.method, res.req.path, res.status, res.body);
  }
  expect(res.status).toBe(201);
  return res;
}


Use it:

const r = await expectOK(request(app).get("/users").query({ q, limit: 10, offset: 0 }));

4) Mongo hygiene (kill the mystery 500s)

Indexes: document required compound indexes in the model file with comments. If you switch (name, homeTown) → (name, homeTownId), drop the old one in a migration or a beforeAll guard in tests.

2dsphere/GeoJSON: always seed loc: { type: "Point", coordinates: [lng, lat] } (never just lat/lng).

Connection reuse: one connection per worker; don’t connect in app and in tests unless you check mongoose.connection.readyState.

5) Routes & test-only hooks (kept, but only in test)

Keep error branch routes (/__err-nonfinite) and audit flush (POST /__audit) guarded by NODE_ENV === "test" and registered before 404/error handlers.

For 404 tests, use a path that doesn’t match params (e.g., /users/does/not-exist) to avoid 400 from :id validators.

6) Coverage playbook (hit 90% without flailing)

Add micro-specs that tick cold branches:

App: audit 204, non-finite error → 500, service 404, root 404.

Controllers: one “happy”, one “validation error”, one “not found”.

Search endpoints: test “no q → all-in-radius” path by setting cutoff high in test env.

When timeboxed, lower gates temporarily (lines/statements/branches/functions) by <1% in vitest.config.ts and leave a TODO with date.

Use /* c8 ignore next */ only on impossible defensive lines (e.g., double-guarded defaults).

7) Import paths & config (prevent path chaos)

Tests under backend/services/<svc>/test should import ../src/....

vitest.config.ts:

plugins: [viteTsconfigPaths]

setupFiles: [".../test/setup.ts", ".../test/seed/runBeforeEach.ts"]

Keep all: true but explicitly exclude pure data models or generated code you won’t test right now.

8) Zod diagnostics (know what failed)

When a test gets 400/500 unexpectedly, log the body once (see helper above).

Prefer mirroring the app’s minimal-create payload used by already-passing specs (don’t invent new payloads under pressure).

If a field tends to cause friction (e.g., time strings, 7-bool arrays), bake a known-good factory in test/factories/<entity>.ts.

9) Flake killers

Set REDIS_DISABLED=1 (or equivalent) in tests when route caching exists.

Force PORT=0 for ephemeral ports.

Clamp typeahead/list limits in tests (e.g., limit=5) and assert arrays, not exact totals, to avoid data drift.

10) “Do nots”

Don’t seed in app.ts. Ever.

Don’t rely on alphabetical ordering unless you sort explicitly in the query.

Don’t assert exact IDs from seeds; assert presence or shapes.

If you want, I can hand you a ready-to-paste user-service skeleton: vitest.config.ts, test/setup.ts, test/seed/runBeforeEach.ts, and test/utils/http.ts with the names flipped to USER_*. That’s usually enough to make round two a glide path instead of a slog.
```
