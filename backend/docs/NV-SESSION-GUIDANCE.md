nv-session-guidance
# NowVibin Session Guidance — Zero-Drift Playbook

Date: 2025-11-02

## Objective
Eliminate session-to-session drift by loading a fixed map of files → classes/modules → methods at start, and by enforcing SOP rituals (design → file drop → test).

## Start-of-Session Ritual (Do Every Time)
1) Paste **SOP (Concise)**.
2) Declare **active service** and current objective.
3) **Ask for current files** before any edit. No unseen overwrites. Whole-file drops only.
4) Load the **flow map** (below) and confirm which pieces already exist.
5) Do a **design pass** (bulleted), then a single-file drop.
6) Run/interpret smoke test(s). Instrument with `requestId`.

## Flow Map (Template Service: entity-crud)
```mermaid
flowchart TD
  A[index.ts] --> B[app.ts (extends AppBase)]
  B --> C[routes/xxx.route.ts]
  C --> D[controllers/xxx.read.controller.ts]
  D --> E[handlers/read.handler.ts]
  D --> F[handlers/batch-read.handler.ts]
  B --> G[controllers/xxx.create.controller.ts]
  G --> H[handlers/create.handler.ts]
  B --> I[controllers/xxx.update.controller.ts]
  I --> J[handlers/update.handler.ts]
  B --> K[controllers/xxx.delete.controller.ts]
  K --> L[handlers/delete.handler.ts]
  subgraph Shared
    M[@nv/shared/dto/* (implements IDto, extends DtoBase)]
    N[@nv/shared/dto/DtoBag]
    O[@nv/shared/dto/DtoRegistry]
    P[@nv/shared/db/DbReader]
    Q[@nv/shared/db/DbWriter]
    R[@nv/shared/contracts/*.contract.ts (Zod)]
    S[@nv/shared/base/* & problem.ts]
  end
  E --> P
  F --> P
  H --> Q
  J --> Q
  L --> Q
  P --> N
  Q --> M
```

## Guardrails
- **No barrels/shims.** Import concrete files or `@nv/shared/*` aliases only.
- **DTO-only domain.** No models/schemas leak.
- **Adapter-only coercion.** DB types never escape adapters.
- **One `DtoBag` at edges.** Even for singletons.
- **Id name is `id`.** No `xxxId` anywhere.
- **Registry required.** `type` discriminator must resolve to a registered DTO or fail fast.

## Pre-Drop Checklist
- Are we modifying an existing file? If yes, we must see the **user’s current copy**.
- Is the file single-concern and <200 lines? If not, split.
- Top-of-file header: **path + ADR references** (0049, 0050, others).
- Does the change alter contracts? If yes, update smoke tests in the same step.

## Test Discipline
- DTO round-trip per type; id immutability check.
- Bag round-trip (mixed types).
- Reader/Writer normalization tests (ObjectId↔string, Date↔ISO).
- Batch/cursor next/last-page edges.
- Controller returns `DtoBag` shape always.
- Boot self-test: Registry coverage, log counts, fail if missing.

## Instrumentation
- `info` for meaningful ops; `debug` for traces; include `x-request-id` everywhere.
- On error: **what failed**, **why**, **how to fix**.
