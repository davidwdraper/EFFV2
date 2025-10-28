adr0045-index-hints-boot-ensure
# ADR‑0045 — DTO Index Hints (Burn‑After‑Read) & Boot‑Time Ensure

## Context
- We moved to a DTO‑only architecture: DTOs are the single source of truth for data shape and persistence behavior.
- Services must create/ensure database indexes deterministically **at boot**, not ad‑hoc in controllers.
- We must keep **zero adhesion** between:
  1) generic service plumbing,
  2) DTO declarations, and
  3) database specifics.
- Index declarations belong to the DTO. Translation + application belong to DB adapters at boot.
- We need idempotent behavior, minimal runtime baggage, and clarity in logs.

## Decision
1) **DTO declares index hints** via a **discriminated union** (no DB code in DTO).
2) A shared helper **consumeIndexHints(DtoCtor)** reads the hints **once** and **burns** them (removes from class).
3) The app calls **ensureIndexesForDtos({ dtos, svcEnv, log })** in **onBoot()** (before routes).
4) **mongoFromHints(entity, hints)** translates abstract hints → Mongo specs (DB‑specific kept in adapter).
5) **applyMongoIndexes(collection, specs)**:
   - Preflights collection; creates it if missing.
   - Applies indexes idempotently.
   - Sanitizes options (e.g., omit `sparse` unless boolean) to avoid driver complaints.
6) **SvcEnvDto** is opaque config. Adapters only read keys via `getEnvVar(name)` (e.g., `NV_MONGO_URI`, `NV_MONGO_DB`, `NV_MONGO_COLLECTION`).

## Implementation Notes
- **Burn‑after‑read:** `consumeIndexHints` supports either `static indexHints` or `static getIndexHints()` on DTO classes. After reading, it deletes the static or replaces the function with a no‑op and tracks the DTO in a `WeakSet` to prevent re‑consumption.
- **No controller work:** `ControllerBase` contains **no** index logic.
- **Boot order:** `onBoot()` → ensure indexes → mount routes → run service.
- **Logging:** Helper logs `index_hints_consumed`, `collection_created`, per‑index `index_applied`, and summary `index_ensured`. Failures log with actionable detail but **do not** block boot.
- **Mongo option hygiene:** Optional flags like `sparse` are included **only** when boolean. (`undefined`/`null` are dropped.)

## Example — DTO Hints (all scenarios in one place)
```ts
// @nv/shared/dto/templates/xxx/xxx.dto.ts (excerpt)
import { BaseDto } from "@nv/shared/dto/base.dto";

export class XxxDto extends BaseDto {
  // Declarative, DB‑agnostic hints. Read once at boot and burned.
  static indexHints = [
    // 1) Plain lookup (ascending) — single field
    { kind: "lookup", fields: ["txtfield1"] },

    // 2) Compound lookup
    { kind: "lookup", fields: ["numfield1", "numfield2"] },

    // 3) Unique index
    { kind: "unique", fields: ["txtfield2"], options: { name: "uniq_txtfield2" } },

    // 4) Text index (multi‑field)
    { kind: "text", fields: ["txtfield1", "txtfield2"] },

    // 5) TTL index (single datetime field)
    { kind: "ttl", field: "createdAt", seconds: 60 * 60 * 24 },

    // 6) Hashed index (Mongo only)
    { kind: "hash", fields: ["shardKey"], options: { name: "hash_shardKey" } },

    // 7) Sparse flag (include only if truly sparse)
    { kind: "lookup", fields: ["optionalField"], options: { sparse: true } },
  ] as const;

  // …rest of DTO (state, validation, toJson())
}
```

## Example — Boot Hook (service app)
```ts
// t_entity_crud/src/app.ts (excerpt)
import { ensureIndexesForDtos } from "@nv/shared/dto/persistence/indexes/ensureIndexes";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";

protected async onBoot(): Promise<void> {
  await ensureIndexesForDtos({
    dtos: [XxxDto],
    svcEnv: this.svcEnv, // access via AppBase public getter
    log: this.log,
  });
}
```

## Example — Consumption & Adapters (summary)
```ts
// consumeIndexHints(DtoCtor): IndexHint[]
//  - Reads DtoCtor.indexHints / getIndexHints()
//  - Deep‑copies return value
//  - Deletes the static / replaces supplier with no‑op
//  - Marks DtoCtor in WeakSet to prevent double‑read

// ensureIndexesForDtos({ dtos, svcEnv, log }):
//  - For each DTO: consume hints → mongoFromHints(entity, hints)
//  - Resolve collection via getMongoCollectionFromSvcEnv(svcEnv)
//  - applyMongoIndexes(collection, specs, { collectionName, log })

// mongoFromHints(entity, hints):
//  - Translates union {kind, fields|field, options} → Mongo {keys, options}
//  - Drops optional flags unless explicitly set (e.g., sparse only if boolean)

// applyMongoIndexes(collection, specs):
//  - listCollections({ name }) → createCollection(name) if missing
//  - createIndex(keys, options) for each spec (idempotent)
//  - Logs index_applied / index_apply_failed
```

## Consequences
- **Pros**
  - Deterministic boot; idempotent index state.
  - DTO remains the single source of truth for persistence requirements.
  - No coupling: App orchestrates, DTO declares, adapters translate/apply.
  - Smaller runtime memory: hints are burned after read.
  - Clear, actionable logs for Ops.

- **Cons**
  - First boot on a clean DB does a bit more work (collection create + index ensure).
  - If hints are malformed, indexes won’t appear (caught by logs).

## Alternatives Considered
- **Controller‑time ensure:** rejected — non‑deterministic and noisy per‑request.
- **DB‑first (migrations):** viable but adds a separate migration workflow; we can add it later if needed.
- **Keeping hints on DTO at runtime:** rejected — needless memory and risk of double‑apply.

## References
- ADR‑0040/0041/0042/0043 (DTO‑only persistence; controllers/handlers; context & finalize pipeline)
- ADR‑0044 (SvcEnv as DTO — Key/Value Contract)