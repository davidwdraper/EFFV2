# NowVibin Backend — Core SOP (Reduced, Clean) [Concise Version]

## Prime Directives
- Never overwrite unseen work — always start from the current file.  
- Single-concern files; shared logic lives only in `backend/services/shared`.  
- Full file drops only; no partials, no options.  
- No barrels or shims.  
- Env names only — all values come from `.env.*`.  
- Routes are one-liners; controllers stay thin (Validate → DTO → Repo → Return → Audit).  
- Instrumentation everywhere; global error middleware via `problem.ts`.  
- Audit-ready: explicit env validation, no silent fallbacks. Dev ≈ Prod (URLs/ports aside).  
- Canonical truth = Zod contract in `shared/contracts/<entity>.contract.ts`.  
- Always TypeScript OO; base classes shared where appropriate.

---

## Route & Service Rules
- URL: `http(s)://<host>:<port>/api/<slug>/v<major>/<rest>`  
  - Health is versioned: `/api/<slug>/v1/health`  
- CRUD (versioned paths):  
  - `PUT` create  
  - `PATCH` update  
  - `GET` read  
  - `DELETE` idempotent delete  
- No `PUT /:id` full replaces.  
- Gateway strips `<slug>` and proxies via svcconfig.  
- Mount health before auth/middleware.

---

## Template Service Blueprint
Flow: **contract → DTO → mapper → model → repo → controller → route**  
- Model: `bufferCommands=false`; indexes defined.  
- Repo: returns domain objects only.

---

## Safe Field Add SOP
1. Add to contract → update DTO → adjust mapper → update model.  
2. Add 2 tests: mapper round-trip + minimal controller.

---

## Logging & Audit
- Shared logger; propagate `x-request-id`.  
- WAL audit flushes once per request.  
- SECURITY logs ≠ WAL logs.  
- Every meaningful operation should be logged at `info` level.  
- Heavy instrumentation with `debug` logs for traceability.  
- When the Logger service is complete, log levels will be runtime-adjustable and can optionally forward to the log DB for production triage.

---

## Security & S2S
- Only gateway is public; all others require valid S2S JWT.  
- `verifyS2S` runs after health, before body parsers/routes.  
- Gateway never forwards client `Authorization`.  
- All S2S calls via shared `SvcClient` (`callBySlug`).

---

## Deployment
- Dev/local: HTTP allowed on 127.0.0.1.  
- Staging/prod: HTTPS only, `FORCE_HTTPS=true`, HTTP→308.

---

## Session Ritual
Paste SOP → declare active service → paste full current files → merge drops only.

---

## File Discipline
- Top comment: path + ADR refs.  
- Inline “why,” not “how.”  
- Always ensure wiring is complete.  
- Never drift; ask if logic exists before adding.  
- First line of every drop = repo path.

---

## Process Notes
- Design discussion → file drop → test → next file.  
- One file at a time unless requested.  
- Reuse in shared; use DI where logical.  
- Baby steps — correctness over speed.

---

## Environment Invariance
- No literals or defaults tied to env.  
- All config from env or svcconfig.  
- Fail-fast if missing config.  
- Dev == Prod behavior.  
- No backward compatibility; greenfield only.  
- “Could this line ship to prod unchanged?” If not, fix it.

---

## App.ts = Orchestration Only
- Defines **what** happens, not **how**.  
- Wires base classes, middleware, and routes.  
- No business logic — that lives in `controllers`, `services`, or `handlers`.  
- Think of `app.ts` as a “runtime table of contents.”

---

## Single-Concern Classes
- One reason to change.  
- No mixing validation/persistence/routing/mapping.  
- Classes >200 lines or multi-purpose → split.  
- Each class must be describable in one sentence.  
- Shared base classes only for true cross-service concerns.

---

## Best-in-Class > Minimal Diffs
- Correctness > smallest edit.  
- Fix plumbing, don’t bend it.  
- Bugs fixed at edges, not middle layers.  
- Delete cleverness; prefer boring, explicit code.

---

## DTO-First Development
- DTOs are canonical; domain data lives only in DTOs.  
- Each DTO inherits from `DtoBase` and implements `IDto`.  
- DTO validates and authorizes its own data (getters/setters).  
- Multiple DTOs for same entity only with clear justification (e.g., internal vs. public view).  
- If a DTO leaves the service boundary, it must be defined under `services/shared/src/dto/<slug>.<purpose>.dto.ts`.

---

## Template Service Types
- `entity-crud`: DB-backed CRUD template (with live test DB).  
- `micro-orchestrator (MOS)`: cross-service coordination.  
- `api-adapter`: interfaces external APIs.  
- `daemon`: cron/background task.  
Each is fully runnable by cloning and assigning a port.

---

## Crud Template File Hierarchy
```
backend/services/t_entity_crud/
└─ src/
   ├─ index.ts              → bootstrap only
   ├─ app.ts                → orchestration only (extends AppBase)
   ├─ routes/
   │   ├─ <route>.route.ts
   ├─ controllers/
   │   ├─ <route>.controller/
   │   │   ├─ <route>.controller.ts
   │   │   └─ handlers/
   │   │       ├─ <handler>.<route>.handler.ts
   ├─ services/
   ├─ dtos/
   ├─ repos/
```

**Rules:**  
- Handlers = single-purpose.  
- Services = cross-handler logic.  
- DTOs = data authority.  
- Repos = persistence only.  
- Controllers = orchestrators only.

---

## UserType Enum
```ts
export const enum UserType {
  Anon = 0,
  Free = 1,
  LowFee = 2,
  HighFee = 3,
  AdminDomain = 4,
  AdminSystem = 5,
  AdminRoot = 6,
}
```
