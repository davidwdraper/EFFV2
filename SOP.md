# NowVibin Backend — Core SOP

**(Reduced, Clean, Locked)**

## 1. Prime Directives (Non-Negotiable)

- Never overwrite unseen work — always start from the **current full file**.
- **Full file drops only**. No partials. No diffs. No options.
- **Single-concern files**. Shared logic lives **only** in `backend/services/shared`.
- No barrels. No shims. No compatibility layers.
- **Environment invariance**:
  - Env _names only_. No literals. No defaults. No fallbacks.
  - Fail fast if config is missing.
  - Dev == Prod behavior (URLs/ports aside).
- Canonical truth = **DTO**.
- TypeScript **OO only**. Shared base classes where justified.
- If a rule conflicts with speed, **speed loses**.

## 2. Rails Are Law

- Routes are **one-liners only**.
- Controllers **orchestrate pipelines**, never do work.
- All logic lives in **handlers**.
- Instrumentation is mandatory.
- Errors flow through `problem.ts` only.
- If the rails are wrong, **we change the rails**, not bend code around them.
- No back-compat. Greenfield means clean breaks are expected.

## 3. URL & Service Contract

```
/api/<slug>/v<major>/<dtoType>/<rest>
```

- Health is versioned: `/api/<slug>/v1/health`
- CRUD semantics:
  - `PUT` → create
  - `PATCH` → update
  - `GET` → read
  - `DELETE` → idempotent delete
- ❌ No `PUT /:id` full replaces.
- Gateway strips `<slug>` and proxies via svcconfig-resolved port.
- Gateway never forwards client `Authorization`.
- Health mounts before auth/middleware.

## 4. Service Blueprint

**route → controller → pipeline → handlers → DtoBag(DTO) → service API**

- Mongo:
  - `bufferCommands=false`
  - Explicit indexes
- Persistence helpers operate **only** on DTO JSON.
- DTOs never cross service boundaries un-bagged.

## 5. DTO-First Development

- DTOs are canonical truth.
- Data lives only inside DTOs.
- DTOs:
  - Extend `DtoBase`
  - Implement `IDto`
  - Validate and authorize via accessors
- External DTOs live in `services/shared/src/dto`.

## 6. Persistence & Wire Shape

- Persistence uses `dto.toJson()` only.
- Wire shape handled at controller boundaries via `DtoBag`.
- No models, schemas, mappers, or leaked shapes.

## 7. Handlers

| Prefix      | Responsibility   |
| ----------- | ---------------- |
| `code.*`    | Pure logic       |
| `toBag.*`   | DTO → bag        |
| `fromBag.*` | bag → response   |
| `db.*`      | Single DB op     |
| `s2s.*`     | Service call     |
| `api.*`     | External adapter |

- Every handler requires a colocated `.test.ts`.
- Filename must fully describe behavior.

## 8. Controller Layout (New Only)

```
routes/<route>.route.ts
controllers/<route>.controller/<purpose>.pipeline/*
```

## 9. Logging & Audit

- Shared logger everywhere.
- Propagate `x-request-id`.
- WAL flushes once per request.
- No silent failures.

## 10. Security & S2S

- Only gateway is public.
- All internal traffic is S2S.
- All calls via `SvcClient`.

## 11. App.ts Discipline

- Orchestration only.
- No business logic.

## 12. TypeScript Discipline

- No helper narrowing hacks.
- `any` requires justification.
- No `*Like` types.

## 13. Bug Fixing

- One best solution.
- Fix edges, not internals.
- Delete cleverness.

## 14. Session Ritual

1. Paste SOP
2. Declare service
3. Paste full files
4. Merge drops only

## 15. ADR Rules

- ADRs required for rail changes.
- Delivered as downloadable `.md`.
- Ask for ADR number first.

## 16. Greenfield Rule

No back-compat. Ever.

## 17. Shared meta

- All unions, types, enums, structs, etc., that span multiple files, belong in their own shared file in shared/src/base/app

## 18. Unsolicited Change

- NEVER make change to files other than what has been explicitly agreed to.
