# NowVibin — t_entity_crud Upgrade Plan (DtoBag, DbReader/Writer, Batching)

## Ground Rules (SOP rails)
- One file at a time. Full file drops only.
- First line in every file = repo path header.
- Reference ADRs: **ADR-0047**, **ADR-0048**, **ADR-0045**.
- No barrels/shims. No env fallbacks. DTO = single source of truth.

---

## Objectives (what we’re changing)
1) Add **DtoBag** (immutable) + **DtoBagView** (read-only lens).
2) Define **DbReader** (readOne/readBatch with keyset) and **DbWriter** (writeOne/writeBatch).
3) Move **batching** to **DbReader**; let paging be a consumer of batching.
4) Keep controllers **thin**: Validate → DTO → (DbReader/Writer) → Return → Audit.

---

## Deliverables (exact files to introduce/update)
**Shared (new)**
- `backend/services/shared/src/dto/DtoBase.ts`
- `backend/services/shared/src/dto/DtoBag.ts`
- `backend/services/shared/src/dto/DtoBagView.ts`

**Shared (new, DB boundary)**
- `backend/services/shared/src/db/DbReader.ts`
- `backend/services/shared/src/db/DbWriter.ts`
- `backend/services/shared/src/db/cursor.ts`
- `backend/services/shared/src/db/orderSpec.ts`

**Template service (t_entity_crud)**
- Update controllers to call **DbReader.readBatch** (not ad-hoc queries).
- Update create/update/delete controllers to call **DbWriter**.
- Keep **routes** as one-liners; preserve existing smoke semantics.

**Tests/Smokes**
- Generic smokes stay green (001–009).
- Add one new smoke: **010-batch-cursor** (assert deterministic next-page via cursor).

**Docs**
- Ensure ADR headers referenced in file tops:
  - ADR-0047 (DtoBag/DtoBagView/Batching)
  - ADR-0048 (DbReader/DbWriter Contracts)
  - SOP (Reduced, Clean)

---

## Sequence (step-by-step, safe order)

### Phase 1 — Foundations (shared)
1) DtoBase.ts — JSON ctor + optional validation; `fromJsonArray()` helper.
2) DtoBag.ts — immutable bag; view builders only.
3) DtoBagView.ts — indices, iterator, `toJsonArray()`.

### Phase 2 — DB Boundary
4) orderSpec.ts — enforce stable order (primary + `_id` tie-breaker).
5) cursor.ts — encode/decode `{ order, last, rev }` (base64 JSON).
6) DbReader.ts — readOne/readBatch interfaces with cursor.
7) DbWriter.ts — writeOne/writeBatch interfaces; structured results.

### Phase 3 — Integrate t_entity_crud
8) Controllers swap repo calls → DbReader/DbWriter.
9) Routes remain one-liners.
10) Logging: add batch breadcrumbs.

---

## Controller Patterns

**Read (list/batch)**
- Build filters.
- Use `DbReader.readBatch()` → returns `{ bag, nextCursor }`.
- Optional `DtoBagView` filtering for UI refinements.
- Return `.toJsonArray()` + `nextCursor`.

**Write**
- DTO from request JSON.
- `DbWriter.writeOne(dto)` or `DbWriter.writeBatch(bag)`.

---

## Indexing (Mongo exemplar)
- Primary: `{ h3: 1, startAt: 1, _id: 1 }`.
- Selective: `{ h3: 1, genre: 1, startAt: 1, _id: 1 }`.
- Always include `_id` in sort.

---

## Smokes
**010-batch-cursor.sh**
- Seed > limit items.
- GET with limit=N → verify page + cursor.
- GET with cursor → next page, no overlap, deterministic order.

---

## What I’ll Ask You For
1) Current controller files (`create`, `update`, `readOne`, `list`).
2) Confirm order spec and default limit.
3) Confirm whether list returns cursor always or only when requested.

---

## Rollback Plan
- Shared additions are additive.
- Controllers switched one at a time; easy rollback.
- Old repo read/write code stays until parity proven.

---

## “First 15 Minutes” Checklist
- Paste current controllers (path headers included).
- Confirm order spec and default limit.
- Drop DtoBag + DtoBagView first, then DbReader/DbWriter, then list controller.

---

## ADR References
- ADR-0047 — DtoBag/DtoBagView + DB-level batching.
- ADR-0048 — DbReader/DbWriter contracts.
- ADR-0045 — NV Service Clone Tool (template replication).
