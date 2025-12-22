# NowVibin Backend — Core SOP (Reduced, Clean) [Concise Version]

## Prime Directives

- Never overwrite unseen work — always start from the current file.
- Single-concern files; shared logic lives only in `backend/services/shared`.
- Full file drops only; no partials, no options.
- No barrels or shims.
- Env names only — not hard coded values or fallbacks.
- Routes are one-liners; controllers orchestrate pipelines of **handlers**.
- Instrumentation everywhere; global error middleware via `problem.ts`.
- Audit-ready: explicit env validation, no silent fallbacks. Dev ≈ Prod (URLs/ports aside).
- Canonical truth = DTO.
- Always TypeScript OO; base classes shared where appropriate.

---

## Route & Service Rules

- URL: `http(s)://<host>:<port>/api/<slug>/v<major>/<dtoType>/<rest>`
  - Health is versioned: `/api/<slug>/v1/health`
- CRUD (versioned paths):
  - `PUT` create
  - `PATCH` update
  - `GET` read
  - `DELETE` idempotent delete
- No `PUT /:id` full replaces.
- Gateway strips `<slug>` and proxies via svcconfig replacement port value.
- Mount health before auth/middleware.

---

## Template Service Blueprint

Flow: **route → controller → pipeline → handlers → DtoBag(DTO) → service API**

- Model: `bufferCommands=false`; indexes defined.
- Repo: comprises shared DbReader and DbWriter helpers that work with DTOs.
- DTOs never leave a module boundary outside a DtoBag wrapper.

---

## Safe Field Add SOP

1. Update DTO → done.
2. Add 2 tests: DTO round-trip + minimal controller.

---

## Logging & Audit

- Shared logger; propagate `x-request-id`.
- WAL audit flushes once per request.
- SECURITY logs ≠ WAL logs. WAL not complete yet.
- Every meaningful operation should be logged at `info` level.
- Heavy instrumentation with `debug` logs for traceability.
- When the Logger service is complete, log levels will be runtime-adjustable and can optionally forward to the log DB for production triage.

---

## Security & S2S

- Only gateway is public; all others require valid S2S JWT (JWT not in place yet).
- `verifyS2S` runs after health, before body parsers/routes. (Not in place yet)
- Gateway never forwards client `Authorization`.
- All S2S calls via shared `SvcClient` (`callBySlug`).

---

## Deployment

- Dev/local: HTTP allowed on 127.0.0.1.
- Staging/prod: HTTPS only, `FORCE_HTTPS=true`, HTTP→308.

---

## Session Ritual

Paste SOP → declare active service → paste full current files → merge drops only.  
Be pro-active. Warn if session is getting too bloated for your efficient processing.

---

## File Discipline

- Repo Path/Filename on 1st line.
- ADR refs.
- Inline “why,” not “how.”
- Always ensure wiring is complete.
- Never drift; ask if logic exists before adding.
- All returned files in a code block.

---

## Process Notes

- Design discussion → file drop → test → next file.
- One file at a time unless requested.
- Reuse in shared; use DI where logical.
- Baby steps — correctness over speed.
- Never take a fast path over long-term correct path.
- Never provide options; always take best long-term commercial path.
- Project is new and greenfield with no clients. All internal interfaces must be explicit.
- Never leave code incomplete with "come back later" comments. All code 100% before moving on.

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
- No business logic — that lives in `services`, or `handlers`.
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
- DTO data is used via getters but never lives outside the DTO.
- Each DTO inherits from `DtoBase` and implements `IDto`.
- DTO validates and authorizes its own data (getters/setters).
- Multiple DTOs for same entity service only with clear justification (e.g., internal vs. public view).
- If a DTO leaves the service boundary, it must be defined under `services/shared/src/dto/<slug>.<purpose>.dto.ts`.

---

## Template Service Types

- `t_entity-crud`: DB-backed CRUD template (with live test DB).

The following are templates yet to be built:

- `micro-orchestrator (MOS)`: cross-service coordination. Multiple DTO types expected.
- `api-adapter`: interfaces external APIs.
- `daemon`: cron/background task.  
  Each is fully runnable by cloning and assigning a port.

---

## Crud Template File Hierarchy (Updated — New Controller Standard)

> **Note:** Existing controllers are NOT retrofitted.  
> This hierarchy applies to **all new controllers going forward**.

```
backend/services/t_entity_crud/
└─ src/
   ├─ index.ts                 → bootstrap only
   ├─ app.ts                   → orchestration only (extends AppBase)
   ├─ routes/
   │   └─ <route>.route.ts     → one-liner route wiring only
   ├─ controllers/
   │   └─ <route>.controller/
   │       └─ <purpose>.pipeline/
   │           ├─ code.<purpose>.ts
   │           ├─ toBag.<DtoClassName>.ts
   │           ├─ fromBag.<DtoClassName>.ts
   │           ├─ db.<collectionName>.<crudOp>.ts
   │           ├─ s2s.<serviceName>.<endpoint>.ts
   │           ├─ api.<hostName>.<endpoint>.ts
   │           ├─ index.ts                      → pipeline composition only
   │           ├─ code.<purpose>.test.ts
   │           ├─ toBag.<DtoClassName>.test.ts
   │           ├─ fromBag.<DtoClassName>.test.ts
   │           ├─ db.<collectionName>.<crudOp>.test.ts
   │           ├─ s2s.<serviceName>.<endpoint>.test.ts
   │           └─ api.<hostName>.<endpoint>.test.ts
```

### Naming Rules (Locked)

- All `<angleBracketNames>` are **camelCase**.
- No additional dots beyond the required handler prefix.
- `<hostName>` is a major proper name, e.g. `GoogleMaps`, `Stripe`, `Twilio`.
- `<crudOp>` ∈ `{ create | read | update | delete | list | patch }`.
- Every handler **must** have a corresponding `.test.ts` file.
- Tests live beside the handler.

### Handler Type Semantics (Explicit)

| Prefix      | Responsibility                                              |
| ----------- | ----------------------------------------------------------- |
| `code.*`    | Pure in-process logic (derive, normalize, validate, decide) |
| `toBag.*`   | Hydrate DTO(s) into a DtoBag                                |
| `fromBag.*` | Extract DTO(s) from a bag for response shaping              |
| `db.*`      | Single DB operation via DbReader / DbWriter / DbDeleter     |
| `s2s.*`     | Service-to-service call via SvcClient                       |
| `api.*`     | External API integration (adapters only)                    |

If a handler doesn’t fit **exactly one** row above, it’s illegal.

### Handler Naming Invariant (Locked)

A handler filename must fully describe what it does without reading its contents.  
If the name requires a comment to explain it, the handler is incorrectly scoped.

---

## UserType Enum

```ts
export const enum UserType {
  Anon = 0,
  Viber = 1,    (no fee)
  Prem-Viber = 2,   (monthly fee)
  PromptEditor = 3,
  AdminDomain = 4,
  AdminSystem = 5,
  AdminRoot = 6,
}
```

---

## Shared Imports & Paths

- Shared files can be accessed at: `@nv/shared/` rather than `../../../shared/src/`
- Files **within** `backend/services/shared/src` do **not** use `@nv/shared/` aliases; they use explicit relative imports.

---

## Error Messages (Ops Guidance Required)

When throwing errors, ensure the message includes guidance and suggestions for Ops to triage the situation.

---

## Persistence & Wire Shape (DTO-First, Bagged)

- **Persistence** only sees DTO JSON via `dto.toJson()` (and DTO construction via constructor / factory discipline).
- **Wire shape** is handled at controller boundaries via DtoBags and body helpers (e.g., `toBody()` / `fromBody()`), not by ad-hoc leaked shapes.
- No models, no schemas, no mappers, no leaked shapes. The DTO is the only source of truth.

---

## ADR Rules

- Always provide ADR docs as downloadable `.md` files.
- For the 1st ADR in a session, ask for the ADR number to use.

---

## Greenfield Discipline (No Back-Compat)

As we build out the backend, refactoring is expected. We never build shims, fallbacks, or worry about back-compat. We’re greenfield and in total control of all interfaces — everything must be tight. If entity A needs a function in B that doesn’t exist, we don’t add it to A; we put it in B where it belongs.

---

## TypeScript Discipline

- No helper methods to narrow TS type guards. All typing must be designed and implemented correctly.
- There must be a good valid reason for the type `any`.
- Don’t want to see the extension `Like` in any of the code.

---

## Fixing Bugs (One Best Solution)

When fixing issues or bugs, never offer two or more solutions when one is clearly the preferred. We are never doing quick fixes and always require the best long-term production solution. Dev == prod.

---

## Proactive Rules

- Proactively tell me when it's time to start a new session.
- Proactively suggest alternatives and better ways to solve problems if you disagree with my approach.
- If, when building code, you're unsure of an object or module's interface, ask for a code drop rather than guess on a function or approach.
- No unfinished code.
- No forward-looking TODO promises.
- No passive “can be wired later.”
- No comments implying skipped invariants.
- Every invariant is either enforced in code or explicitly failed.
