# **NowVibin Backend — Living Design (Canonical SOP Edition)**

> This document is the single source of truth across sessions.  
> **Ritual:** ADR first, one-file drops, baby steps. No ghosts, no drift.

---

## **Chapter 1 — Core SOP (Reduced, Clean)**

### Prime Directives

- **Never overwrite unseen work.** Always ask for and work from the current file.
- **Single-concern files** — shared logic only in `backend/services/shared`.
- **Full file drops only** — no fragments or options.
- **No barrels or shims.**
- **Env names only** — values live in `.env.dev`, `.env.test`, `.env.docker`, etc.
- **Routes are one-liners** — import handlers only.
- **Thin controllers:** Validate → DTO → repo → return domain → push audits to `req.audit[]`.
- **Instrumentation everywhere:** shared logger logs entry/exit with `x-request-id`; audit all mutations.
- **Global error middleware:** everything funnels through `problem.ts` + error sink.
- **Audit-ready:** explicit env validation; **no silent fallbacks**; dev ≈ prod behavior (URLs/ports aside).
- **Canonical truth** = Zod contract in `services/shared/contracts/<entity>.contract.ts`.

### Route & Service Rules

- **URL convention (no exceptions)**  
  `http(s)://<host>:<port>/api/<slug>/v<major>/<rest>`  
  `http(s)://<host>:<port>/api/<slug>/v<major>/health` ← versioned health
- `<slug>` = singular service name; REST resources = plural.
- **CRUD (versioned paths)**
  - **Create:** `PUT /api/<slug>/v1/<resources>` (service generates `_id`)
  - **Update:** `PATCH /api/<slug>/v1/<resources>/:id`
  - **Read:** `GET /api/<slug>/v1/<resources>/:id`
  - **Delete:** `DELETE /api/<slug>/v1/<resources>/:id` (idempotent)
  - **No** `PUT /:id` full-replace.
- **Gateway proxy** strips `<slug>` and forwards to service base URL from svcconfig.
- **Health first** — mount health route before any auth/middleware.

### Template Service Blueprint

- All new services **clone Act 1:1**.
- Flow: **contract → DTOs → mappers → model → repo → controllers → routes**.
- Model: `bufferCommands = false`; indexes defined.
- Repo: **returns domain objects only**.

### Safe Field Addition SOP

1. Add to contract.
2. Update DTOs.
3. Adjust mappers.
4. Update model (indexes/required).
5. Add **2 tests:** mapper round-trip + minimal controller.

### Logging & Audit (Critical)

- Use **shared logger util**; propagate `x-request-id`.
- Audit middleware **flushes once per request**.
- Separate **SECURITY** logs (guardrail denials) from **WAL audit** (passed requests).

### Security & S2S (Critical)

- **Only gateway is public;** workers require valid S2S JWT.
- `verifyS2S` mounted **right after health** and **before** body parsers/routes.
- Gateway **never** forwards client `Authorization`.
- Gateway and workers use shared `callBySlug` to mint tokens and make internal calls.

### Deployment & Transport

- **Dev/local:** HTTP allowed on `127.0.0.1`.
- **Staging/prod:** HTTPS only; `FORCE_HTTPS = true`; HTTP → 308.

### File Discipline

- Top-of-file comment with **path/filename** and **design/ADR references**.
- Inline “**why**” comments, not “how.”
- Always ensure new code is **wired in** — no hanging strays.
- **Never drift.** Ask before duplicating logic.
- First line of every file drop:  
  `// backend/services/<slug>/src/<file>.ts`

### Process Notes

- Every file drop is **preceded by design discussion**.
- ChatGPT drops new files or merges after seeing current files.
- Drops are **one file at a time** unless explicitly batched.
- Prefer code reuse and OO patterns (`class` over function when reasonable).
- **Baby steps:** one file, test, next — user drives the design.

---

## **Chapter 2 — ADR Gospel (Stop-the-Line)**

- **No ADR, no code.** Create and accept ADR before any file drop.
- **Headers must reference real ADRs.** No ghost numbers.
- One ADR per architectural decision; small and focused.
- **Numbering:** `adr0001, adr0002, …`
- **Filename:** `docs/adr/adr####-<slug>.md`
- **Commit messages include:** `Refs:` or `Implements:` ADR number.
- **Scope test:** affects > 1 file or constrains future work ⇒ requires ADR.
- **Enforcement:** If a code header references an unknown ADR, stop and create it immediately.

---

## **Chapter 3 — Current Architecture Decisions (Index)**

- **ADR-0001 — Gateway-Embedded SvcConfig; separate svcFacilitator for JWKS & Resolution**  
  _Accepted_ — Gateway holds svcconfig mirror for fast proxying; svcFacilitator remains source of truth for JWKS and slug→URL resolution.

- **ADR-0003 — Gateway Loads Mirror by Calling svcFacilitator (Pull, Not Push)**  
  _Accepted_ — Gateway pulls service map from svcFacilitator on boot/interval.

- **ADR-0004 — Auth Service Skeleton (No Minting Yet)**  
  _Accepted_ — Auth boots with mock hashing; health endpoints only.

- **ADR-0006 — Gateway Edge Logging (Pre-Audit, Toggleable)**  
  _Proposed_ — Edge hit logging before proxy; verbosity toggle; separate SECURITY vs WAL logs.

- **ADR-0013 — Versioned Gateway Health**  
  _Proposed_ — Gateway health at `/api/gateway/v1/health`; never proxied; canonical envelope.

- **ADR-0014 — Base Hierarchy: ServiceEntrypoint vs ServiceBase**  
  _Proposed_ — `ServiceEntrypoint` = composition root (bootstrap); `ServiceBase` = inheritance root (logger/env/config). No global logger.

---

## **Chapter 4 — Class Hierarchy Map (Target State)**

```text
(composition root; not in inheritance tree)
┌──────────────────────────────────────────────────────────────┐
│ ServiceEntrypoint (bootstrap)                                │
│ - loads env files, sets ports/host                           │
│ - constructs app via buildApp()                              │
│ - starts HTTP server; handles shutdown                       │
└──────────────────────────────────────────────────────────────┘
creates
▼
┌──────────────────────────────────────────────────────────────┐
│ ServiceBase (NEW)                                            │
│ - protected log, env (and later config/metrics/clock)        │
│ - single source for process-level deps                        │
└───────────────┬───────────────────────────┬──────────────────┘
                │                           │
┌───────────────▼──────────────┐   ┌────────▼─────────┐
│ AppBase* (optional)          │   │ ControllerBase    │
│ (framework wiring helpers)   │   │ (HTTP helpers)    │
└───────────────┬──────────────┘   └────────┬─────────┘
                │                           │
┌───────────────▼──────────────┐   ┌────────▼─────────┐
│ GatewayApp                   │   │ Gateway*Controller│
└──────────────────────────────┘   └───────────────────┘
                │                           │
┌───────────────▼──────────────┐   ┌────────▼─────────┐
│ RouterBase* (optional)       │   │ RepoBase (data)   │
└───────────────┬──────────────┘   └────────┬─────────┘
                │                           │
┌───────────────▼──────────────┐   ┌────────▼─────────┐
│ HealthRouter                 │   │ UserRepo/AuthRepo │
└──────────────────────────────┘   └───────────────────┘
```

_Notes:_

- `ServiceEntrypoint` is **not** a superclass; it **creates** the app.
- All runtime classes ultimately **extend `ServiceBase`**.
- Routers may stay functions, but class routers gain `this.log` for free.

---

## **Chapter 5 — Request / Route Flow Maps**

### A) Gateway Health (Local, Never Proxied)

Client → GET `/api/gateway/v1/health`  
GatewayApp (mounted early, before proxy)  
↳ GatewayHealthRouter (local)  
↳ returns `{ ok:true, service:"gateway", data:{ status:"live", … } }`

**Invariant:** Any `/api/gateway/...` path is **excluded** from proxy.

### B) Proxied Service Call (Versioned)

Client → GET `/api/user/v1/health`  
GatewayApp → ApiProxy → resolve `<slug>@<major>` via svcconfig mirror → swap origin → forward.  
Upstream service returns JSON → Gateway returns to client.

**Invariant:** Missing version on non-gateway API → `400 invalid_request`.

---

## **Chapter 6 — Bootstrap & Logging Invariants**

- **Logger ownership:** Created once in `ServiceBase`; `this.log` is always available. No global providers.
- **Env access:** `ServiceBase` exposes `protected env` and `getEnv(name, required=true)`; fail-fast on missing required vars.
- **Mount order:** Health → request-id/logging → auth/parsers → proxy (last).
- **Proxy guard:** `/api/gateway/...` never proxied; others must be versioned or fail 400.

---

## **Chapter 7 — Technical Debt Register**

> Track short-term refactor and cleanup tasks that don’t require ADRs.  
> Remove entries as resolved.

### Bootstrap / Base Hierarchy

- [ ] Rename `ServiceBase.ts` → `ServiceEntrypoint.ts` (complete when imports migrated).
- [ ] Introduce `shared/base/ServiceBase.ts` as inheritance root.
- [ ] Migrate `ControllerBase`, `RepoBase`, and routers to extend `ServiceBase`.
- [ ] Eliminate all `logger.provider` imports and global logger mutations.

### Gateway

- [ ] Verify `gateway/src/routes/health.ts` mounted early (before proxy).
- [ ] Standardize path `/api/gateway/v1/health`.
- [ ] Update header in `gateway/src/app.ts` (ADR-0003 reference).
- [ ] Remove stale/duplicate health mount logic.

### Documentation & ADR Hygiene

- [ ] Ensure code headers use correct ADR numbers.
- [ ] Cross-check ADR index for numbering continuity.
- [ ] Move “Proposed” ADRs to “Accepted” once implemented.
- [ ] Add link references between ADR-0001 ↔ 0003 ↔ 0013 ↔ 0014.

### Testing & Verification

- [ ] Re-run gateway health smoke after refactor; expect `service="gateway"` and `status="live"`.
- [ ] Add unit test for `ServiceEntrypoint` lifecycle (preStart → onReady → onShutdown).

### Future Debt Candidates

- [ ] Unify edge logging toggles (`EDGE_LOG_ENABLED`, `LOG_LEVEL`).
- [ ] Add shared `ConfigValidator` once `ServiceBase` exposes `this.config`.
- [ ] Audit `FORCE_HTTPS` enforcement across services.
- [ ] Consolidate WAL and audit logging under `@nv/shared/wal`.
- [ ] Ensure WAL metrics appear in health endpoints.
- [ ] Remove legacy per-service queue logic after shared class adoption.

---

_**Process:**_  
At session start, review this list. At session end, tick off completed items and prune resolved ones. Promote anything large or cross-service to a dedicated ADR.
