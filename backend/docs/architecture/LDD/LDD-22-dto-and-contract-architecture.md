# LDD-22 — DTO & Contract Architecture  
*(Zod Contracts, DTO Classes, Bags, Views, and Wire Shape)*

---

## 1. Purpose

This chapter defines the **canonical DTO architecture** for NowVibin (NV):

- How contracts are defined (Zod schemas & TypeScript types)  
- How DTO classes wrap those contracts  
- How DTOs are instantiated, validated, patched, and serialized  
- How DtoBag and DtoBagView work as the only allowed in-memory containers  
- How wire envelopes (`items[] + meta`) relate to DTO instances  
- How DTOs connect to persistence (collection names, index hints)  

This is the spine for every CRUD service and any service that pushes or pulls structured data.

---

## 2. Core Principles

1. **Contract-first**  
   The Zod contract is the single source of truth for shape and validation. DTO classes *wrap* the contract; they do not diverge from it.

2. **DTO-only persistence**  
   No naked documents, no arbitrary maps, no half-structured blobs. Everything persisted must be a DTO (or a bag of DTOs) that passes the contract.

3. **Immutable by default**  
   Once constructed, a DTO’s fields are treated as immutable; changes go through structured methods (`patchFrom`, etc.), never direct property writes.

4. **Wire == DTO JSON**  
   The JSON representation of a DTO is the wire-level contract. There is no second “doc” envelope or private hidden shape for the same data.

5. **Explicit collections**  
   Each DTO class defines its collection via `dbCollectionName()`. No implicit or ad-hoc collection naming.

6. **No reflection**  
   Registry maps types → DTO ctors explicitly. No directory scans, no runtime reflection to find DTOs.

---

## 3. Contracts: Zod as Source of Truth

Each domain type has a Zod schema, e.g.:

```ts
// env-service.contract.ts (conceptual)
export const EnvServiceSchema = z.object({
  id: z.string().uuid(),
  env: z.string().min(1),
  slug: z.string().min(1),
  version: z.number().int().nonnegative(),
  vars: z.record(z.string(), z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  updatedByUserId: z.string().min(1),
});
```

### 3.1 Contract Rules

- Contracts define **all fields**.  
- Contracts may define optional fields with explicit semantics; nothing is “forgotten” in the DTO layer.  
- ID fields and their rules (e.g. `_id` vs `id`) must be defined in the contract, not sprinkled throughout the code.

### 3.2 Types from Contracts

From the Zod schema:

```ts
export type EnvServiceContract = z.infer<typeof EnvServiceSchema>;
```

DTOs wrap this type; they do not invent their own.

---

## 4. DTO Base Class

All DTOs extend `DtoBase`. The base is responsible for:

- owning the internal plain-data representation  
- tracking metadata such as `collectionName`  
- exposing core utilities shared across services  

### 4.1 Responsibilities

- **Construction** from JSON (via `fromJson` on subclass)  
- **Serialization** to plain JSON (`toJson()`)  
- **Cloning** (shallow clone with same contract fields)  
- **Patching** (via `patchFrom`) while respecting the contract  
- **Collection name** get/set  
- **Index hints** (static on subclass)  

### 4.2 What DtoBase Does NOT Do

- It does not talk to the database.  
- It does not log or know about HTTP.  
- It does not know about handlers or routes.  

It’s purely an in-memory representation of “a thing that matches the contract.”

---

## 5. DTO Class Shape

A typical DTO class:

```ts
export class XxxDto extends DtoBase {
  // static: contract, collection, index hints
  public static contract = XxxSchema;
  public static dbCollectionName(): string { return "xxx"; }
  public static indexHints = [ /* ... */ ];

  // construction is internal-only; call fromJson to create
  private constructor(secret: DtoSecret) {
    super(secret);
  }

  // DTO hydration entry point
  public static fromJson(json: unknown, opts?: { mode?: "wire" | "db"; validate?: boolean }): XxxDto {
    // contract validation + normalization
    // returns new XxxDto with data stored inside base
  }

  public toJson(): XxxContract {
    // returns the exact contract-shaped JSON
  }

  public patchFrom(partial: Partial<XxxContract>): void {
    // applies partial update within contract rules
  }
}
```

### 5.1 Secret-Based Instantiation

`DtoBase.getSecret()` and the DTO’s private constructor enforce:

- DTOs can only be created via controlled factory methods (`fromJson`, newXxxDto in registry, etc.).  
- No uncontrolled `new XxxDto()` from random code.

---

## 6. DTO Modes: `mode: "wire" | "db"`

DTO hydration uses a `mode` to interpret JSON:

- **wire**: JSON came from the HTTP edge or S2S; must match wire contract exactly.  
- **db**: JSON came from the database; may include `_id` or adapter-specific fields.

### 6.1 Why Distinguish Modes?

- To avoid leaking persistence details into wire contracts.  
- To allow ID normalization (e.g., Mongo `_id` → DTO `id` or vice-versa) inside the adapter, not in the DTO itself.  
- To keep tests very explicit about which shape they are simulating.

---

## 7. DTO Validation & Errors

### 7.1 Validation Points

DTO validation happens:

- on `fromJson()` when `validate:true`  
- inside `patchFrom()`  
- sometimes inside dedicated helpers (e.g., ID validators)

### 7.2 Error Shape

DTO validation errors must be:

- pure data, never Express responses  
- convertible into Problem+JSON by controllers  
- include `issues[]` with `{ path, code, message }` semantics

Outcome:

- DTO remains the data-level “truth,” while controllers apply HTTP semantics.

---

## 8. DtoBag — Immutable DTO Container

`DtoBag<TDto>` is the in-memory container for DTOs.

### 8.1 Responsibilities

- Hold an **ordered array** of DTOs (immutable once created).  
- Provide foundational operations:
  - length, iteration  
  - simple filters/slices via `view()`  
  - `ensureSingleton()` / `getSingleton()` to enforce singletons  

### 8.2 Singleton Helpers

- `ensureSingleton()` throws if `items.length !== 1`.  
- `getSingleton()` calls `ensureSingleton()` and returns the single DTO.

These are heavily used in flows where a single DTO is required (most `read` and `update` operations).

---

## 9. DtoBagView — Read-Only Lens

`DtoBagView` is a read-only, filtered/sliced view over a bag.

### 9.1 Responsibilities

- Provide stable, non-mutating operations:
  - filter  
  - map  
  - pagination slices  
- Never detach from the underlying bag semantics; it’s just a view.

### 9.2 Why Views?

- To avoid accidental re-sorting or duplication of core data.  
- To provide “query-like” mechanics without making DTOs responsible for DB queries.

---

## 10. Wire Envelope: `items[] + meta`

All HTTP and S2S endpoints use a canonical envelope:

```json
{
  "items": [
    { /* DTO JSON */ },
    { /* DTO JSON */ }
  ],
  "meta": {
    "limit": 10,
    "cursor": "abc",
    "count": 10
  }
}
```

### 10.1 Invariants

- `items` is always an array (may be empty on some reads, but rarely).  
- `meta` contains pagination and summary fields; it never replaces or shadows DTO fields.  
- No nested `doc` property is allowed—ever.

### 10.2 From Wire to DTO

Handlers use:

1. `BagPopulate*` handlers to:
   - parse JSON body or query  
   - hydrate DTOs with `Dto.fromJson(json, { mode:"wire", validate:true })`  
   - pack them into a `DtoBag<TDto>`  

2. Downstream handlers & controllers always operate on bags, never raw JSON.

---

## 11. DTOs & Persistence

DTOs connect to persistence via:

- `dbCollectionName()` (static)  
- `indexHints` (static array)  

Adapters (like DbWriter/DbReader) use those:

- to know which collection to write to  
- to seed indexes at boot (via `ensureIndexesForDtos`)  
- to convert DB results into DTOs (mode `"db"`)

### 11.1 ID Semantics

The canonical ID lives inside the DTO:

- e.g., `id: string` or `_id: string` per contract  
- DB adapters map between DB-native IDs and DTO IDs  
- Controllers and handlers are unaware of DB-specific ID forms (e.g., Mongo ObjectId vs UUID).

---

## 12. Registries & DTO Type Keys

DTO types are keyed by short, stable strings (e.g., `"xxx"`, `"env-service"`).

### 12.1 ServiceRegistryBase Contract

- `ctorByType(): Record<string, DtoCtor<IDto>>`  
- `hydratorFor(type, { validate })` returns a function:
  - that calls `fromJson(json, { mode:"wire", validate })`  
  - seeds `collectionName` via `dbCollectionName()` if necessary  

### 12.2 Why Registry?

- Single place to declare:
  - DTO class  
  - collection mapping  
  - index hints (via DTO static)  
- Lets controllers operate generically:
  - choose dtoType from route  
  - call `seedHydrator(ctx, dtoType)`  
  - allow pipelines to hydrate correct DTOs without reflection

---

## 13. DTO Lifecycles in CRUD Flows

### 13.1 CREATE

1. Controller builds context; seeds dtoType & hydrator.  
2. `BagPopulatePutHandler`:
   - parses wire JSON  
   - builds `DtoBag<TDto>` from body  
3. Validation occurs via `fromJson` and any extra constraints.  
4. DbWriter takes the bag and writes DTOs to collection.

### 13.2 READ

1. Params/query parsed.  
2. DbReader queries DB and returns bag of hydrated DTOs.  
3. Handler checks singleton vs list semantics.  
4. Controller finalizes into standard envelope.

### 13.3 UPDATE

1. Bag of incoming patch DTOs built from body.  
2. Existing DTO(s) loaded into a separate bag.  
3. Patch handler:
   - clones existing DTO  
   - calls `patchFrom` with sanitized patch JSON  
   - stores updated DTO into bag  
4. DbWriter persists new DTO state.  

### 13.4 DELETE

1. DbReader loads DTO (optional singleton enforcement).  
2. DbWriter removes doc by ID, using ID from DTO.  
3. Optionally WAL logs before deletion.

---

## 14. Patch & Merge Rules

DTOs expose `patchFrom()` for partial updates:

- Only allowed fields in the contract may be patched.  
- Some fields are “immutable” after creation (e.g., `env`, `slug`, `version`, `id`).  
- Patch operations must either:
  - ignore immutable fields, or  
  - fail with validation error if caller attempts to patch them.

---

## 15. DTO Design Anti-Patterns (Forbidden)

- DTOs that read from `process.env`.  
- DTOs that talk directly to Mongo or SvcClient.  
- DTOs exposing public fields that can be mutated directly.  
- Storing DTO instances directly in Express `req` objects.  
- DTOs that embed additional “sub-contracts” not modeled in Zod.

---

## 16. Testing DTOs & Contracts

Tests must:

- instantiate DTOs exclusively via `fromJson()` or registry helpers.  
- test:
  - valid JSON → DTO round-trip (`fromJson → toJson`)  
  - invalid JSON → validation errors with `issues[]`  
  - `patchFrom()` semantics for allowed/disallowed fields  
- ensure ID, `dbCollectionName`, and `indexHints` are correctly wired.

---

## 17. Future Evolution

Potential enhancements:

- Contract versioning per DTO (e.g., v1, v2) beneath the same service version.  
- Declarative contract linting (no optional fields without clear semantics).  
- Schema introspection for docs generation (OpenAPI/JSON schema).  
- Per-field security classification (PII, sensitive, etc.) to drive masking.  
- DTO-level change-tracking (for more efficient patches and WAL entries).

---

End of LDD-22.
