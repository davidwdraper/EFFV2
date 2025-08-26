# NowVibin Backend — New-Session SOP (Act-style template + shared test harness)

Paste this at the start of each session. It keeps all services identical, audit-ready, and test harnesses consistent.

---

## Prime Directives

- State-of-the-art, fast, scalable, **audit-ready**.
- Single-concern source files; shared logic in `services/shared`.
- **Full file drops only.** Existing files must be pasted in full.
- You never give me options. No "Option A / Option B". **Decide and deliver.**
- All services **mirror Act** structure 1:1.
- Routes = **one-liners**. No logic in routes.
- **No baked values.** Env names only; values come from env files.
- Instrumentation everywhere (pino / pino-http).
- **Audit all mutations.** Controllers push → `req.audit[]`, flushed once.
- `try/catch` everywhere that matters. `asyncHandler` + global error middleware.
- Audit-ready: explicit env validation, consistent logging, **no silent fallbacks**.
- Every file begins with repo path in a `//` comment.
- Dev bootstrap may default `ENV_FILE` to `.env.dev`; **prod must set explicitly**.

---

## Canonical Service Layout (Act-style, with additions)

backend/services/<svc>/
├─ index.ts
├─ vitest.config.ts
├─ .env.test
├─ scripts/ # one-off ops (e.g., loadTowns.ts); NO app imports that create listeners
│ └─ README.md # how to run scripts with ENV_FILE and ts-node
├─ src/
│ ├─ bootstrap.ts # loads env, config, db; wires app; exports { app, serverHandle? }
│ ├─ app.ts # express app factory; mounts middleware/routes; no listen()
│ ├─ config.ts # env parsing/validation; no defaults for required keys
│ ├─ db.ts # mongoose connect; bufferCommands=false; exports connection
│ ├─ contracts/ # zod schemas + DTOs (request/response)
│ ├─ types/ # TS types/interfaces that aren’t zod
│ ├─ middleware/ # asyncHandler, requestId, logger, auth, audit, cache, errors
│ ├─ models/ # schemas + indexes
│ ├─ controllers/ # business logic only
│ ├─ routes/ # one-liners mapping HTTP → controller
│ └─ utils/ # svc-local utilities only
└─ test/
├─ setup.ts # global setup; env; logger silencing; db connect; seeds
├─ seed/
│ ├─ runBeforeEach.ts # truncate/seed idempotently; logs pre/post counts
│ └─ factories.ts # valid payload builders
├─ helpers/
│ ├─ mongo.ts # shared connection reuse; ensureIndexes
│ ├─ server.ts # boot app on PORT=0; expose supertest agent
│ └─ http.ts # expectOK/expectCreated + Problem+JSON dump on fail
├─ unit/
└─ e2e/

shell
Copy
Edit

### Shared

backend/services/shared/
├─ config/env.ts # ENV_FILE resolution + requireEnv(name)
├─ health.ts # health/ping factories
└─ utils/
├─ logger.ts # pino base + remote log POSTer
├─ logMeta.ts # getCallerInfo, service tags
├─ cache.ts # redis client, cacheGet(ns, ttlVar)
└─ requestId.ts

yaml
Copy
Edit

---

## Environment Policy

- **Dev:** `ENV_FILE` optional; defaults `.env.dev`.
- **Prod:** `ENV_FILE` **required**.
- Vars **namespaced** (e.g., `ACT_PORT`, `USER_MONGO_URI`).
- **No fallbacks** for required keys. Fail fast in `config.ts`.

---

## Bootstrap & Index

- `index.ts` imports `./src/bootstrap` **first**. Nothing else.
- `bootstrap.ts` logs env path, asserts required vars, connects DB, builds app, and **only for runtime** starts `listen()`.

---

## Logging & Audit

- `pino` + `pino-http` with requestId.
- `postAudit` flushes `req.audit[]` once/request (mutations).
- Request ID accepted from headers, else `randomUUID`.

---

## Performance / Ops Notes

- `mongoose.set("bufferCommands", false)`.
- **Indexes defined in models**; tests call `ensureIndexes()`.
- Redis caching via `shared/utils/cache.ts` (`REDIS_DISABLED=1` in tests).
- Future: circuit breakers, retries, rate limiting.

---

## Test Harness

- Vitest, Node env, 60s timeouts.
- Coverage ≥90% lines/funcs/branches/stmts.
- `c8` ignore only on unreachable lines.
- `vite-tsconfig-paths` plugin.
- Global setup: set envs, silence pino, ensure seeds.
- Seeding via idempotent bulkWrite + namespaced values.
- Supertest helpers: expectOK/Created, dump Problem+JSON on fail.
- Mongo hygiene: reuse connection, ensureIndexes, truncate if needed.
- Keep error/audit test routes under `NODE_ENV=test`.
- Assert **shapes**, not IDs.

---

## Where We Left Off

1. Add new folders (scripts/, contracts/, types/) across all services.
2. Retest Acts via gateway (4000) + direct (4002); coverage ≥90%.
3. Clone harness onto User service:
   - directory endpoint with cache.
   - seeds (role matrix).
   - mirror auth gates.
   - env vars like `USER_NAME_LOOKUP_MAX_IDS`.

---

## Session-start Ritual

1. Paste **this SOP**.
2. Say which service we’re on.
3. Paste existing files I must merge (full, first line = repo path).
4. I deliver full drops, no options.

---

## Quick Sanity Checklist

- [ ] No logic in routes.
- [ ] Required envs asserted.
- [ ] bufferCommands=false; indexes in models.
- [ ] Request-ID logging.
- [ ] Audit events flushed.
- [ ] `.env.test` present.
- [ ] Tests green via gateway + direct.
- [ ] Coverage ≥90% all metrics.
- [ ] Seeds idempotent + descriptive.
- [ ] No baked values.

---

**End SOP v2**

We are picking up where we left off, debugging Act tests.
