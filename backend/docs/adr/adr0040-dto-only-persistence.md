// docs/architecture/adr/adr0040-dto-only-persistence.md
adr0040-dto-only-persistence

# ADR-0040 — DTO-Only Persistence via Managers (DbManager / FsManager)

## Context

NowVibin’s backend will ultimately consist of many small, cloneable services that all share the same core pattern.  
Our foundation is **DTO-First**:

- **No external models or contracts.** The DTO *is* the schema, validator, and data authority.  
- **Encapsulation absolute.** Services never inspect DTO internals; they communicate only via `fromJson()` and `toJson()`.  
- **Persistence neutrality.** Managers move opaque DTO JSON between storage back-ends (DB or FS) without interpretation.

Every service that writes data also owns its database, so its persisted DTOs are always canonical.  
Writes will be **fronted by an FS-backed Write-Ahead Log (WAL)** so database latency or outages never cause data loss.

---

## Decision

### Core Pattern

We define two generic managers that operate exclusively on DTOs.

#### `DbManager<TDto>`
- Constructed with a **DTO class** implementing `fromJson()` / `toJson()` and a **database adapter** (`IDb`).
- Performs CRUD (`create`, `findById`, `save`, `deleteById`, `list`).
- Writes call `dto.toJson()` directly; reads hydrate DTOs with `DtoClass.fromJson(json, { validate: false })`.
- DB `_id` remains the gospel. DTO exposes a `<slug>Id` getter for route clarity.

#### `FsManager<TDto>`
- Same interface, using an **IFs** adapter.
- Used for WAL, audit, and archival duties.
- Every DB write passes through this layer first.

---

## Validation Discipline

### `fromJson()` contract

All DTOs implement:
```ts
static fromJson(json: unknown, opts?: { validate?: boolean }): IDto;
```

- When `validate: true` (default): full schema validation is performed.  
  Used for **inbound data from untrusted sources** (e.g., API payloads, S2S calls).  
- When `validate: false`: assumes data originated from this service’s own DB, WAL, or in-memory mirror.  
  Used for **trusted internal hydration** to avoid redundant validation overhead.

### Rules

- **Wire input:** `fromJson(payload, { validate: true })` — always validate.
- **Internal writes:** DTOs already validated once; skip re-validation for efficiency.
- **DB reads & WAL replays:** safe to use `{ validate: false }` because data originated from this service’s DTOs.
- **Cross-service ingress:** always validate, even if the source claims to be trusted.

---

## Error Policy

All thrown errors must include **Ops guidance** for triage — what to inspect, retry, or verify.

---

## Consequences

**Benefits**
- Single DTO authority: one definition per entity.
- Zero shape drift across dozens of clones.
- WAL provides durability and isolates DB latency.
- Validation costs appear only where they matter (ingress).

**Trade-offs**
- Less automatic DB protection (indexes & constraints live outside the DTO).
- Query flexibility and migrations must be handled explicitly in adapters.

---

## Implementation Notes

### DTO Surface (IDto)

```ts
interface IDto {
  // Construction
  static fromJson(json: unknown, opts?: { validate?: boolean }): IDto;

  // Serialization
  toJson(): unknown;

  // Optional friendly ID getter, e.g. get xxxId(): string | undefined;
}
```

- `validate` defaults to `true` to maintain safety.
- DTOs encapsulate all state; managers never read or modify fields directly.

### Database Adapter (IDb)
Minimal required primitives:
- `insert(json)`
- `findById(id)`
- `replaceById(id, json)`
- `deleteById(id)`
- `list(opts?: QuerySpec)`

### Filesystem Adapter (IFs)
Minimal required primitives:
- `write(key, json)`
- `read(key)`
- `delete(key)`
- `list(prefix?)`

### Write-Ahead Log Discipline
- Every DB write is preceded by a WAL write.
- WAL entries are append-only and purged only after confirmed DB success.
- Recovery replays remaining WAL entries using `fromJson(..., { validate: false })`.

---

## Discussion Points / Future Enhancements

1. **Index Discipline** — require `IDb.ensureIndexes()` during bootstrap.  
2. **Optimistic Concurrency** — add optional `_rev` / `_etag`.  
3. **QuerySpec** — lightweight filter/sort/limit support in `IDb`.  
4. **Timestamp Policy** — explicit `dto.touch(now, updatedByUserId)`.  
5. **Response Projection Layer** — prevent leaking internal fields.  
6. **Standard Id Getter Convention** — enforce `<slug>Id`.  
7. **Mirror Management** — TTL/LRU and immutable snapshots.  
8. **Validation Cost** — `validate: false` provides fast path for trusted data.  
9. **Schema Evolution** — include `dto.version`; up-migrate in `fromJson()`.  
10. **Error Taxonomy** — shared codes + Ops hints.  
11. **Security/PII** — decide where field-level encryption occurs.  
12. **FSManager Ordering** — ensure WAL sequence IDs and flush order.  
13. **Performance** — optional compression in `IFs`.  
14. **Test Harness** — fake adapters for unit testing managers.

---

## References

- SOP (Reduced, Clean)
- ADR-0039 — svcenv centralized non-secret env
- ADR-0015 — DTO-First Development

---

## Summary

DTOs own validation and data. Managers perform generic persistence without breaking encapsulation.  
`fromJson()` accepts a `validate` flag, allowing validation only at the system boundaries where untrusted data enters.  
All writes are fronted by an FS-backed WAL for durability, ensuring that every service’s DB remains the single source of truth.
