# ADR-0057 (R1) — ID Generation and Validation with Flat Wire Items

## Context
Frontend clients sometimes provide their own IDs for dedupe/correlation. Backend must enforce canonical, safe IDs and guarantee every persisted DTO has one. Historically, permissive string IDs caused collisions and messy joins. We standardize on **UUIDv4**, lowercase, immutable once set.  
**Change from original ADR-0057**: the edge contract no longer nests fields under `doc`. Items are **flat**.

## Decision

1) **DtoBase**
- One-shot `id` setter. If `id` already exists, replacement attempt is a **no-op** with:
  - `logger.warn("Attempted to overwrite id; operation ignored")`
- On first assignment:
  - Validate against UUIDv4 regex (case-insensitive):
    ```regex
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    ```
  - Normalize to lowercase and store.
- If invalid, throw **400 Bad Request** with:
  ```json
  { "code": "INVALID_ID_FORMAT", "detail": "id must be a UUIDv4" }
  ```

2) **DbWriter**
- On create, if `dto.id` is missing, generate **UUIDv4** and set it via the DTO setter **before** `toJson()`.
- The create response **must include the effective `id`** in the returned DtoBag.

3) **Controllers**
- May set an `id` early (e.g., for WAL correlation) via the DTO setter.
- Must not modify an existing `id` (attempt → WARN no-op).

4) **Frontend & Wire Contract (Flat Items)**
- `PUT /create` payloads **may omit** `id`. If provided, it **must be UUIDv4**.
- **Wire envelope (flat):**
  ```json
  {
    "items": [
      { "type": "xxx", "id": "optional-uuidv4", /* other fields... */ }
    ],
    "meta": { /* optional */ }
  }
  ```
- **No `doc` property.** Handlers hydrate DTOs directly from the **flat item**.
- Responses **always** include the effective `id` inside the returned DtoBag items.

5) **Validation Scope**
- Validation is centralized in the DTO layer on assignment. DbWriter/controllers rely on DTO guarantees (no duplicate validation elsewhere).

## Consequences
- Prevents invalid/duplicate ids and keeps joins canonical.
- Smokes may seed valid UUIDv4s or let backend generate; both paths pass.
- Backend stays self-healing when no id is provided.
- Centralizes id behavior in DtoBase.
- WARNs expose any attempted id churn.

## Implementation Notes
- Use a standard UUIDv4 generator in shared utils.
- Store ids lowercased.
- **Hydration change**: handlers must read **`item.id`**, not `item.doc.id`, and hydrate DTOs from the **flat item**.
- Unit tests:
  - valid UUIDv4 assignment
  - invalid format rejection
  - auto-generation path in DbWriter
  - immutability (WARN on attempted overwrite)
- Smoke tests can run with or without seeded ids; ensure responses echo the final id.

## Migration Guide (from nested `doc` → flat items)
1. **Handlers**: In `bag.populate.get.handler.ts` (or equivalent), hydrate from the flat item.  
   - `const wireId = item.id;`  
   - `const dto = hydrator.fromJson(item, { validate: true });`  
   - `if (wireId) dto.setIdIfUnset(wireId);`
2. **DTOs**: Ensure `fromJson()` accepts flat fields (no `doc`).
3. **Smokes/clients**: Update payloads to the flat format.
4. **Logging**: Keep a debug trace `wireId` vs `dto.id` to verify correctness.
5. **Error mapping**: Unchanged—dup remains 409 with `{ code: "DUPLICATE_KEY" }`.

## Alternatives Considered
- Keep `doc` nesting: rejected—extra envelope buys us nothing and complicates hydration.
- UUIDv7/ULID: deferred for ordering; revisit later.
- Backend-only ids: rejected—some clients need deterministic keys.

## References
- ADR-0040 (DTO-Only Persistence)
- ADR-0041–0043 (Controller/Handler pipeline)
- ADR-0044 (SvcEnv DTO contract)
- ADR-0050 (Wire Bag Envelope) *(superseded by this flat-item variant for create paths)*
