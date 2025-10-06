# NowVibin Backend — Core SOP (Reduced, Clean)

## Prime Directives

- **Never overwrite unseen work** — always ask for and work from the current file.
- **Single-concern files** — shared logic only in `backend/services/shared`.
- **Full file drops only** — no fragments, no options.
- **No barrels or shims.**
- **Env names only** — values live in `.env.dev`, `.env.test`, `.env.docker`, etc.
- **Routes are one-liners** — import handlers only.
- **Thin controllers** — Validate → DTO → repo → return domain → push audits to `req.audit[]`.
- **Instrumentation everywhere** — shared logger logs entry/exit with `x-request-id`; audit all mutations.
- **Global error middleware** — everything funnels through `problem.ts` + error sink.
- **Audit-ready** — explicit env validation; **no silent fallbacks**; dev ≈ prod behavior (URLs/ports aside).
- **Canonical truth** = Zod contract in `services/shared/contracts/<entity>.contract.ts`.
- \*\*Typescript OO design principles always. Base classes in shared when/where applicable.

## Route & Service Rules

- **URL convention (no exceptions)**
  - `http(s)://<host>:<port>/api/<slug>/v<major>/<rest>`
  - `http(s)://<host>:<port>/api/<slug>/v<major>/health` ← **health is versioned**
- `<slug>` = singular service name; REST resources = plural.
- **CRUD (versioned paths)**
  - **Create:** `PUT /api/<slug>/v1/<resources>` (service generates `_id`, returns it)
  - **Update:** `PATCH /api/<slug>/v1/<resources>/:id`
  - **Read:** `GET /api/<slug>/v1/<resources>/:id`
  - **Delete:** `DELETE /api/<slug>/v1/<resources>/:id` (idempotent)
  - **No** `PUT /:id` full-replaces.
- **Gateway proxy** strips `<slug>` and forwards to service base URL from svcconfig.
- **Health first** — mount health route before any auth/middleware.

## Template Service Blueprint

- All new services **clone Act 1:1**.
- Flow: **contract → DTOs → mappers → model → repo → controllers → routes**.
- Model: `bufferCommands=false`; indexes defined.
- Repo: **returns domain objects only**.

## Safe Field Addition SOP

1. Add to contract.
2. Update DTOs.
3. Adjust mappers.
4. Update model (indexes/required).
5. Add **2 tests**: mapper round-trip + minimal controller.  
   ✅ Do this even if broader test suite is deferred.

## Logging & Audit (critical)

- Use **shared logger util**; propagate `x-request-id`.
- Audit middleware **flushes once per request**.
- Separate **SECURITY** logs (guardrail denials) from **WAL audit** (passed requests).

## Security & S2S (critical)

- **Only gateway is public;** workers require valid S2S JWT.
- `verifyS2S` mounted **right after health** and **before** body parsers/routes.
- Gateway **never** forwards client `Authorization`.
- Gateway and workers use shared `callBySlug` to mint tokens and make internal calls.

## Deployment & Transport

- **Dev/local:** HTTP allowed on `127.0.0.1`.
- **Staging/prod:** HTTPS only; `FORCE_HTTPS=true`; HTTP → **308**.

## Session-Start Ritual

- Paste this reduced SOP.
- State which service is **active**.
- Paste **full current files** with repo-path headers.
- Receive full merged drops — **no guessing, no splicing**.

## File Discipline

- Top-of-file comment with **path/filename** and **design/ADR** references.
- Inline “**why**” comments, not “how”.
- Always ensure new code is **wired in** — no hanging strays.
- **Never drift.** If you don’t know if pre-existing logic exists, **ask first** before building.
- Always—always—**first line of every file drop** should look like:

## Process Notes (what’s been working)

- Every file drop is **preceded by design discussion**.
- Then you (ChatGPT) drop new files or merge into pre-existing files **after asking for my copy**, unless you already have the file in memory during the current session.
- Drops are **one file at a time**, unless I ask for more.
- Always suggest **code reuse** in shared and/or base TypeScript classes. Use **dependency injection** where helpful.
- **Baby steps:** one file, test, then next — I drive the design.

## Current Context

- We’re building the new backend **a bit at a time**, starting with plumbing.
- There is **no logging backend, audit, JWT, or user-auth** yet; auth password is **mock hashed**.
- The last backend bogged down in refactors/regressions. Now: **write a few files, then test.** Baby steps.
