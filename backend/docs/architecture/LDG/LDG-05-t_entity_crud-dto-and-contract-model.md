# LDG-05 — t_entity_crud DTO Architecture, Contract Rules & Index Model

## 1. Purpose
This LDG defines the **DTO architecture**, **Zod contract rules**, **index model**, and **collection naming** conventions for the `t_entity_crud` template.  
These rules apply identically to all NV CRUD-based services and are central to persistence correctness, index determinism, and smoke test stability.

---

## 2. DTO-First Architecture

### 2.1 DTO is the Source of Truth
All entity definitions begin and end with the DTO.  
Everything else derives from it:

- MongoDB collection fields  
- Validation rules  
- Indexes  
- Patch semantics  
- Response shapes  
- Test expectations  

No additional properties are stored outside the DTO.  
No dynamic fields.  
No implicit translation layers.

---

## 3. DTO Contract (Zod)

Each DTO defines a Zod schema in `contracts/<dtoType>.contract.ts`.

### Required fields:
- `_id` (UUID v4)  
- All entity fields (string, number, enums, arrays, etc.)  
- Metadata fields if defined (timestamps, etc.)

### Contract Responsibilities:
- strict validation  
- default values (where appropriate)  
- index hints  
- DTO field types  
- patch allowances  

If a field is not in the contract, it does **not** exist in the entity.

---

## 4. DTO Class (ts)

DTO classes wrap domain behavior and enforce:

- `.fromJson(json, { validate: true })`  
- `.toJson()` returning clean persistence shape  
- `.schema` (static Zod reference)  
- deterministic `_id` behavior  
- strict mapping of domain objects  

### Important:
`.toJson()` **always includes `_id`**.  
This is required for DbWriter ID behavior and smoke tests such as 014.

---

## 5. Deterministic ID Rules

### 5.1 ID format
- UUID v4  
- Always lowercase  
- No alternate IDs (legacy idFieldName removed)  
- DTO constructor enforces presence  

### 5.2 ID lifecycle
- Create: client may supply `_id`, else service generates  
- Read: always required  
- Patch: cannot change  
- Delete: required  
- Persistence: always stored as `_id`  

Breaking these rules breaks the entire persistence model.

---

## 6. Index Model

### 6.1 Index Definition
Indexes are defined in the DTO contract:

```ts
export const XxxDtoContract = z.object({
  _id: z.string().uuid(),
  txtfield1: z.string(),
  numfield1: z.number(),
}).describe({
  indexes: [
    { fields: ["txtfield1"], options: { unique: false } },
    { fields: ["numfield1"], options: { unique: false } }
  ]
});
```

### 6.2 Boot-Time Index Building
Each service uses its DTO registry to:

1. Read index hints from contract
2. Resolve collection names via env-service
3. Build indexes using deterministic createIndex calls

Indexes must be:
- idempotent  
- deterministic  
- matching smoke test expectations  

### 6.3 _id Index
Mongo automatically indexes `_id`, no extra index definition required.

---

## 7. Collection Naming (Service-Specific)

Collection names come from **env-service**, not the DTO or the service:

```
NV_COLLECTION_<DTO_UPPER> = "<collection-name>"
```

Example for DTO type "xxx":
```
NV_COLLECTION_XXX = "xxx"
```

This allows:
- multi-DTO services with separate collections  
- template cloning without collisions  
- centralized configuration for all services  

Clones automatically receive their collection names.

---

## 8. DTO Registry

### Purpose:
The registry binds:
- dtoType → DTO class  
- dtoType → contract  
- dtoType → collection name  

### Runtime:
Routes pull the DTO type from the URL:

```ts
const DtoCtor = DtoRegistry.get(dtoType);
```

Missing DTO type → 400 Bad Request.

---

## 9. DTO Patch Rules

### 9.1 Patch Contract
Patch handlers use:

```ts
XxxPatchSchema = XxxDtoContract.partial().strict();
```

Rules:
- Cannot patch `_id`  
- Cannot introduce fields  
- Cannot bypass validation  

### 9.2 Patch Process
The sequence:
1. Validate patch payload  
2. Load existing DTO  
3. Apply patch  
4. Validate resulting DTO  
5. Write back to persistence  

This produces stable updates and prevents silent schema drift.

---

## 10. Persistence Shape

Persistence through DbWriter uses:

```ts
const json = dto.toJson();
```

Persistence shape must match DTO contract exactly:
- types  
- field names  
- presence of `_id`  
- allowed fields only  

No dynamic serialization.

---

## 11. Smoke Test Implications

### Contract correctness affects:
- 003 duplicate-create  
- 004 read  
- 006 patch  
- 009 list  
- 011 cursor last page  
- 014 create-id-dup-retry  
- 021 dto round-trip

### Index correctness affects:
- boot-time index checks  
- duplicate detection  
- list/query performance  
- multi-collection clone stability  

### DTO registry correctness affects:
- route validation  
- DTO selection  
- any multi-DTO service behavior  

---

## 12. Summary
`t_entity_crud`’s DTO and contract architecture guarantees:

- strict schema enforcement  
- perfect persistence determinism  
- clone-safe index building  
- predictable CRUD behavior  
- stable test results  
- consistent domain modeling across all NV services  

DTOs are the *absolute authority* in NV’s architecture — everything flows from them.

