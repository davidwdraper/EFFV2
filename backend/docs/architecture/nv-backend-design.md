# NowVibin Backend — Living Design (Session Anchor)

> This document is the single source of truth across sessions.  
> **Ritual:** ADR first, one-file drops, baby steps. No ghosts, no drift.

---

## Chapter 1 — Core SOP (Reduced, Clean)

### Prime Directives

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

### Route & Service Rules

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

### Template Service Blueprint

- All new services **clone Act 1:1**.
- Flow: **contract → DTOs → mappers → model → repo → controllers → routes**.
- Model: `bufferCommands=false`; indexes defined.
- Repo: **returns domain objects only**.

### Safe Field Addition SOP

1. Add to contract.
2. Update DTOs.
3. Adjust mappers.
4. Update model (indexes/required).
5. Add **2 tests**: mapper round-trip + minimal controller.  
   ✅ Do this even if broader test suite is deferred.

### Logging & Audit (critical)

- Use **shared logger util**; propagate `x-request-id`.
- Audit middleware **flushes once per request**.
- Separate **SECURITY** logs (guardrail denials) from **WAL audit** (passed requests).

### Security & S2S (critical)

- **Only gateway is public;** workers require valid S2S JWT.
- `verifyS2S` mounted **right after health** and **before** body parsers/routes.
- Gateway **never** forwards client `Authorization`.
- Gateway and workers use shared `callBySlug` to mint tokens and make internal calls.

### Deployment & Transport

- **Dev/local:** HTTP allowed on `127.0.0.1`.
- **Staging/prod:** HTTPS only; `FORCE_HTTPS=true`; HTTP → **308**.

### Session-Start Ritual

- Paste this reduced SOP.
- State which service is **active**.
- Paste **full current files** with repo-path headers.
- Receive full merged drops — **no guessing, no splicing**.

### File Discipline

- Top-of-file comment with **path/filename** and **design/ADR** references.
- Inline “**why**” comments, not “how”.
- Always ensure new code is **wired in** — no hanging strays.
- **Never drift.** If you don’t know if pre-existing logic exists, **ask first** before building.
- Always—always—**first line of every file drop** should look like:
  // backend/services/log/src/app.ts

markdown
Copy code

### Process Notes (what’s been working)

- Every file drop is **preceded by design discussion**.
- ChatGPT drops new files or merges into pre-existing files **after asking for my copy**, unless already in memory during the current session.
- Drops are **one file at a time**, unless I ask for more.
- Prefer **code reuse** in shared and/or base TypeScript classes. Use **dependency injection** where helpful.
- **Baby steps:** one file, test, then next — I drive the design.

### Current Context

- We’re building the new backend **a bit at a time**, starting with plumbing.
- There is **no logging backend, audit, JWT, or user-auth** yet; auth password is **mock hashed**.
- The last backend bogged down in refactors/regressions. Now: **write a few files, then test.** Baby steps.

---

## Chapter 2 — ADR Gospel (Stop-the-Line)

- **No ADR, no code.** ADR created, discussed, and accepted before any file drop.
- **Headers must reference real ADRs.** No ghost numbers.
- **One ADR per architectural decision;** small and focused.
- **Numbering:** `adr0001, adr0002, …`
- **Filename:** `docs/adr/adr####-<slug>.md`
- **Commit messages include:** `Refs: ADR-####` or `Implements: ADR-####`.
- **Scope test:** affects >1 file **or** constrains future work ⇒ **requires ADR**.
- **Session rule:** ADR first in chat; code drops only after acceptance.
- **Enforcement in sessions:** If code references an ADR not listed in Chapter 3, we **stop** and produce that ADR immediately.

---

## Chapter 3 — Current Architecture Decisions (Index)

> Keep this list authoritative. If a code header references an ADR not here, stop-the-line and add it.

- **ADR-0001 — Gateway-Embedded SvcConfig; separate svcFacilitator for JWKS & Resolution**  
  _Status:_ Accepted  
  _Summary:_ Gateway holds an embedded svcconfig mirror for fast proxying; svcFacilitator remains the source of truth for JWKS + slug→URL resolution (polled/pulled).

- **ADR-0003 — Gateway loads mirror by calling svcFacilitator (pull), not push**  
  _Status:_ Accepted  
  _Summary:_ Gateway **pulls** svc map from svcFacilitator on boot/interval; svcFacilitator does not accept pushed mirrors.

- **ADR-0004 — Auth Service Skeleton (no minting yet)**  
  _Status:_ Accepted  
  _Summary:_ Auth boots with mock hashing, no JWT minting; health endpoints first.

- **ADR-0006 — Gateway Edge Logging (pre-audit, toggleable)**  
  _Status:_ Proposed  
  _Summary:_ Edge hit logging before proxy; flag/toggle for verbosity; separates SECURITY vs WAL.

- **ADR-0013 — Versioned Gateway Health**  
  _Status:_ Proposed  
  _Summary:_ Gateway health lives at `/api/gateway/v1/health`; never proxied; returns canonical envelope (`service=gateway`, `data.status=live`).

- **ADR-0014 — Base Hierarchy: ServiceEntrypoint vs ServiceBase**  
  _Status:_ Proposed  
  _Summary:_ `ServiceEntrypoint` = composition root (bootstrap); `ServiceBase` = inheritance root (logger/env/config). No global `getLogger()`.

> NOTE: You listed both `adr0002-auth-service-skeleton.md` and `adr0002-svcfacilitator-minimal.md`.  
> **Action:** Confirm numbering; duplicates are not allowed. Suggested: keep Auth as `ADR-0004`; assign SvcFacilitator Minimal as `ADR-0002` or `ADR-0005` and update headers accordingly.

---

## Chapter 4 — Active Work & Next Steps

**Primary goal:** Refactor into a clean OO inheritance structure with startup logic in the correct places.  
**Secondary goal:** Fix gateway health routing to pass smoke.

### Step Plan (Stop-the-line where ADR is required)

1. **ADR-0014 (Base Hierarchy) — Discuss & Accept.**

- `ServiceEntrypoint` (bootstrap/composition root) is standardized across services.
- New `ServiceBase` (true base class) provides `this.log`, `this.env`, future `this.config`.
- Eliminate global `logger.provider.getLogger()`.

2. **Rename:** Current `shared/bootstrap/ServiceBase.ts` → `shared/bootstrap/ServiceEntrypoint.ts`.

- Keep lifecycle hooks: `preStart()`, `buildApp()`, `onReady()`, `onShutdown()`.
- Remove global logger mutation from here.

3. **Introduce:** `shared/base/ServiceBase.ts`.

- Singleton logger + env getters.
- All runtime classes ultimately extend this.

4. **Make sub-bases extend ServiceBase:**

- `shared/base/ControllerBase.ts` → `extends ServiceBase`
- `shared/base/RepoBase.ts` → `extends ServiceBase`
- (Optional) `shared/base/AppBase.ts` / `RouterBase.ts` → `extends ServiceBase`

5. **Gateway first conversion (thin slice):**

- Convert `gateway/src/routes/health.ts` to a class that `extends ServiceBase`.
- Ensure mount: `this.app.use("/api/gateway/v1/health", new GatewayHealthRouter().router())` **before** proxy.

6. **Fix health routing invariant:**

- `/api/gateway/v1/health` must be served locally (never proxied).
- Canonical envelope: `{ok:true, service:"gateway", data:{status:"live", detail:{uptime, ready, mirrorCount}}}`.

7. **Smoke tests:**

- Run `001-gateway-health.sh`; expect `.service="gateway"` and `.data.status="live"`.

8. **Roll pattern gradually:**

- Convert next router/controller to the new base (one file at a time).
- Kill `logger.provider.ts` once no call sites remain.

**Stop Criteria for Step 1–7:**

- ADR-0014 accepted and referenced in headers.
- Gateway health smoke test passes.
- No file imports `logger.provider` anymore.

---

## Chapter 5 — Class Hierarchy Map (Target After Refactor)

markdown
Copy code
(composition root; not in inheritance tree)
┌──────────────────────────────────────────────────────────────┐
│ ServiceEntrypoint (bootstrap) │
│ - loads env files, sets ports/host │
│ - constructs app via buildApp() │
│ - starts HTTP server; handles shutdown │
└──────────────────────────────────────────────────────────────┘
creates
▼
┌──────────────────────────────────────────────────────────────┐
│ ServiceBase (NEW) │
│ - protected log, env (and later config/metrics/clock) │
│ - single source for process-level deps │
└───────────────┬───────────────────────────┬──────────────────┘
│ │
┌──────▼──────┐ ┌─────▼─────┐
│ AppBase* │ │ ControllerBase │
│ (optional) │ │ (HTTP helpers) │
└──────┬──────┘ └─────┬─────┘
│ │
┌───────▼────────┐ ┌──────▼─────────┐
│ GatewayApp │ │ Gateway*Controller │
└─────────────────┘ └───────────────────┘

cpp
Copy code
│ │
┌──────▼──────┐ ┌─────▼─────┐
│ RouterBase\* │ │ RepoBase │
│ (optional) │ │ (data) │
└──────┬──────┘ └─────┬─────┘
│ │
┌───────▼────────┐ ┌──────▼─────────┐
│ HealthRouter │ │ UserRepo/AuthRepo│
└─────────────────┘ └──────────────────┘
markdown
Copy code

_Notes:_

- `ServiceEntrypoint` is **not** a superclass; it just **creates** the app.
- Everything inside the service ultimately **extends `ServiceBase`**.
- Routers may remain functions if preferred, but class routers gain `this.log` for free.

---

## Chapter 6 — Request/Route Flow Maps (As-Built + Invariants)

### A) Gateway Health (local, never proxied)

Client → GET /api/gateway/v1/health
GatewayApp (mounted early, before proxy)
↳ GatewayHealthRouter (local)
↳ returns { ok:true, service:"gateway", data:{ status:"live", ... } }

python
Copy code
**Invariant:** any `/api/gateway/...` path is **excluded** from proxy.

### B) Proxied service call (versioned)

Client → GET /api/user/v1/health
GatewayApp
↳ ApiProxy (path must match /api/<slug>/v<major>/...)
↳ resolve <slug>@<major> via svcconfig mirror
↳ swap origin (port); keep path/query
↳ forward; strip Authorization; add x-service-name
Upstream User Service → returns JSON → Gateway returns to client

yaml
Copy code
**Invariant:** Missing version on non-gateway API → **400 invalid_request**.

---

## Chapter 7 — Bootstrap & Logging Invariants

- **Logger ownership:**

  - The **only** place that creates the process logger is the `ServiceBase` (singleton inside).
  - No `getLogger()` global. No bootstrap-installed provider.
  - `this.log` is **always** available in subclasses.

- **Env access:**

  - `ServiceBase` exposes `protected env` and `getEnv(name, required=true)` helpers.
  - **Fail-fast** on missing required envs; no silent defaults.

- **Mount order:**

  - Health routes **first**, then minimal request-id/logging (if any), then auth/parsers, then proxy last.

- **Proxy guard:**
  - `/api/gateway/...` is never proxied.
  - All other `/api/<slug>/v<major>/...` must have version; otherwise **400**.

---

## Chapter 8 — Next-Session Bootstrap Checklist (Paste This)

**When starting a new session, paste the following:**

1. **This document** (latest version).
2. **Active Work Pointer:** “We’re on Chapter 4 → Step X.”
3. **Service in focus:** `gateway | auth | user | svcfacilitator`.
4. **Smoke snippet (if failing):** paste the last failing test output.
5. **Only the files we’ll touch next** (full content, with path-on-line-1):
   - `// backend/services/shared/src/bootstrap/ServiceBase.ts` (old) → to be renamed
   - `// backend/services/shared/src/bootstrap/ServiceEntrypoint.ts` (NEW, after rename)
   - `// backend/services/shared/src/base/ServiceBase.ts` (NEW)
   - `// backend/services/shared/src/base/ControllerBase.ts` (extends ServiceBase)
   - `// backend/services/gateway/src/app.ts`
   - `// backend/services/gateway/src/routes/health.ts`
   - `// backend/services/gateway/src/routes/proxy.ts`
   - `// backend/services/shared/src/problem/problem.ts`
   - `// backend/services/shared/src/middleware/requestId.ts` (if present)  
     _(If any are unchanged, say “unchanged” to avoid paste bloat.)_

**Session rule:** I will propose an ADR or confirm an existing one **before** dropping a file.

---

## Chapter 9 — ADR Queue / Ghost Detector

- If we see an ADR reference in headers that’s not in Chapter 3:  
  **STOP → draft ADR → discuss → accept → proceed.**
- Pending checks right now:
  - Confirm numbering for `adr0002-*` duplicates; update Chapter 3 and code headers.

---

## Chapter 10 — Technical Debt Register

> **Purpose:**  
> Track short-term refactor residue and medium-term cleanup tasks that don’t warrant ADRs but must be resolved for long-term maintainability.  
> Each entry should be ticked (✅) once verified complete in a later session.  
> Old, resolved items are removed during normal document grooming.

### Bootstrap / Base Hierarchy

- [ ] ✅ **Rename complete:** `ServiceBase.ts` → `ServiceEntrypoint.ts`
- [ ] Remove temporary alias `export { ServiceEntrypoint as ServiceBase }` after all imports migrate.
- [ ] Introduce and stabilize `shared/base/ServiceBase.ts` (inheritance root).
- [ ] Migrate `ControllerBase`, `RepoBase`, and routers to extend `ServiceBase`.
- [ ] Eliminate all `logger.provider` imports and global logger mutations.

### Gateway

- [ ] Verify `gateway/src/routes/health.ts` is mounted early, before proxy.
- [ ] Standardize health path to `/api/gateway/v1/health` (single source of truth).
- [ ] Update header in `gateway/src/app.ts` (`ADR-0003` wording: “Gateway pulls svc map”).
- [ ] Remove any stale or duplicate health-mount logic from `app.ts`.

### Documentation & ADR Hygiene

- [ ] Update all code headers referencing **ADR-0009** → **ADR-0014**.
- [ ] Cross-check ADR index (Chapter 3) for numbering continuity.
- [ ] Confirm all “Proposed” ADRs move to “Accepted” once implemented.
- [ ] Add link references between ADRs 0001 ↔ 0003 ↔ 0013 ↔ 0014 for traceability.

### Testing & Verification

- [ ] Re-run `001-gateway-health.sh` after refactor; confirm `.service="gateway"`, `.data.status="live"`.
- [ ] Add smoke for `auth` → `user` flow after ServiceBase migration.
- [ ] Add unit test: `ServiceEntrypoint` lifecycle (preStart → onReady → onShutdown).

### Future Debt Candidates

- [ ] Consolidate edge logging toggles (`EDGE_LOG_ENABLED`, `LOG_LEVEL`) under unified config.
- [ ] Introduce shared `ConfigValidator` once ServiceBase exposes `this.config`.
- [ ] Audit each service for `FORCE_HTTPS` enforcement consistency.

### WAL Refactor Checklist

- [ ] Refactor **Gateway** to emit persistent logs via `@nv/shared/wal` when enabled (per ADR-0017).
- [ ] Refactor **Audit** to use `@nv/shared/wal` for all audit events (no direct HTTP-only writes).
- [ ] Consolidate existing gateway and audit WAL logic under the shared `LogWal` class.
- [ ] Ensure WAL metrics (`wal_backlog_records`, `wal_ship_errors_total`, etc.) appear in both gateway and audit health endpoints.
- [ ] Verify shared WAL handles multiple record kinds: `log`, `audit`, and any future feature requiring durability.
- [ ] Remove legacy per-service WAL or queue code after shared class adoption.

- [ ] Edge logging, via log.edge() both at the gateway and in SvcReceiver

---

_**Process:**_  
At session start, review this list aloud.  
At session end, tick off completed items and prune resolved ones.  
If any item grows beyond 1–2 lines or affects multiple services, promote it to a standalone ADR.

---
