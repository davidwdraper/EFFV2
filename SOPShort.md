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

Addendum:

### Environment Invariance (Critical)

- The codebase must be **100% environment-agnostic.**
- There shall be **no** literal references, assumptions, or defaults tied to any environment  
  (e.g., `127.0.0.1`, `localhost`, `dev`, `staging`, etc.).
- All such values **must** come exclusively from environment variables or configuration services  
  (e.g., `SVCFACILITATOR_BASE_URL`, `NV_GATEWAY_PORT`, etc.).
- **Dev == Prod** in all behaviors — only env values differ.
- If a component requires an address or hostname, it must obtain it from its configuration layer, never hardcode or assume defaults.
- Any new literal network or filesystem surface must pass a **“prod-readiness” check**:  
  _Could this line deploy unchanged to prod?_ If not, it’s wrong.

- Never add logic for backwards compatibility! We're greenfield. We do it right every time. If it requires a break, we break, then we fix. One code base, no convenience conditionals.

- Track the things that you believe will be important in subseqent sessions. When our current session gets too slow to continue, I'll ask you to print out in a code block, your saved up memory which I'll in turn save, and provide to you at the beginning of the next.

### Addendum: `app.ts` as Orchestration Only

**Purpose:**  
Clarify that each service’s `app.ts` file serves strictly as an **orchestration layer**, not a logic host.

#### Principles

- `app.ts` defines **what happens and in what order**, never **how** it happens.
- It wires **base classes**, **middleware**, and **routes**, but contains no business logic or helper code.
- Every function or class referenced by `app.ts` must live in its own purpose-built file
  (e.g., `middleware/`, `routes/`, `workers/`, or `services/`).
- `app.ts` is the **service’s table of contents** — anyone reading it should immediately understand the runtime sequence:

### Addendum: Single-Concern Class Principle

**Purpose:**  
Reaffirm that every class in the NowVibin backend exists to do **one thing only** — and do it completely.  
No class should ever mix responsibilities, even if it feels convenient.

#### Core Rule

> A class must have exactly **one reason to change**.

If a class handles multiple concerns — such as validation _and_ persistence, or routing _and_ domain mapping —  
it becomes brittle, harder to test, and impossible to evolve safely.

#### Guidelines

- A class should represent **one conceptual role** in the system (e.g., `UserRepo`, `AuditWalWriter`, `HealthRouter`).
- If a class constructor takes more than 3–4 unrelated dependencies, it’s likely doing too much.
- **Never** combine vertical layers inside a single class:
  - Controller ↔ Repo ↔ Model ↔ Mapper ↔ DTO ↔ Contract
  - Each of those belongs in its own file and class.
- If a class has methods that _feel like separate subsystems_, extract them:
  - `UserService.create()` vs `UserService.notifyFollowers()` → separate classes.
- Cross-cutting utilities (logging, validation, config) belong in **shared base classes** or **dedicated helpers**,  
  never bundled into “manager” or “facade” god-classes.

#### Enforcement

- Any class exceeding ~200 lines or handling multiple layers of logic must be split before merge.
- Every reviewer must ask:  
  “**Can I summarize this class in one sentence?**”  
  If not, it violates the single-concern rule.
- Shared base classes (e.g., `AppBase`, `RouterBase`, `RepoBase`) are allowed only when the concern is truly cross-service.

#### Rationale

This rule guarantees:

- Predictable composition across services (`App → Router → Controller → Repo`).
- Easy unit testing (each class mockable in isolation).
- Minimal refactor friction: replacing one concern never breaks another.

In short: **no god-classes, no mixed responsibilities, no ‘misc’ folders.**  
Every class must do one job — cleanly, completely, and nothing else.

Addendum: Best-in-Class Over Minimal Diffs

Principle: We optimize for correctness, clarity, and long-term stability, not smallest change-set. Minimal edits are fine only if they produce the right system. If a bigger change creates a simpler, cleaner, invariant-driven design, we take it.

Design Rules (non-negotiable)

Contract First: Shared contracts (envelope + body) are the source of truth. Producer and consumer import the same schema. No local variants. No guessing.

Single Envelope, Forever: One RouterBase envelope for every S2S response. Requests are flat bodies. No exceptions.

Opaque Plumbing: Transport never peeks inside payloads. All interpretation happens in logic layers.

DI Everywhere: Dependencies are constructed and injected by the owning service. No factories that hide wiring; no env-driven shape changes in plumbing.

Environment Invariance: No literals, no fallbacks. If a required env/config is missing, fail fast.

Single-Concern Classes: One reason to change. If a class crosses layers (controller ↔ repo, etc.), split it.

No Compatibility Branches: Greenfield only. If a break is required to stay correct, we break and fix.

Frozen Plumbing: Once an invariant holds (envelope, resolver, client/receiver, WAL core), it’s locked. Bugs are fixed at edges (producer/consumer), not by bending plumbing.

Definition of Done (plumbing)

✅ Shared envelope and body schemas validate on both ends.

✅ SvcClient sends flat body, unwraps+validates response envelope via shared schema.

✅ SvcReceiver validates flat request body and wraps response with the standard envelope.

✅ Resolver composes URLs exactly once; callers pass service-local paths only.

✅ Logs show composed base and edge hits that match contract.

✅ WAL replayer drains cleanly (durable FS journal, retries on outage), no schema peeking.

Refactor Policy

If correctness conflicts with “small change,” choose correctness.

Delete cleverness; prefer boring, explicit code.

Any refactor must reduce surface area or increase invariants. If it adds knobs, it’s suspect.

Review Checklist (fast gate)

Does this change strengthen an invariant or introduce one?

Are client and receiver importing the same shared schema?

Any literals or hidden defaults? (If yes, reject.)

Any class doing two jobs? (If yes, split.)

Could this ship to prod unchanged with different env values? If not, fix it.

Your previous session notes below:
