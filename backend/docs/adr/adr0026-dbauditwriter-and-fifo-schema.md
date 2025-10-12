# adr0026-dbauditwriter-and-fifo-schema

## Context

The Audit service’s current WAL subsystem (ADR-0024, ADR-0025) ensures append-only durability via `FileWalJournal`, but persistence ends at the file system.  
To make the audit pipeline fully durable and queryable, the next tier — **DbAuditWriter** — must persist each WAL entry into MongoDB in a FIFO collection.

Goals:

- Establish a **drop-in writer** implementing `IAuditWriter`.
- Achieve **crash-proof persistence**: once appended to the DB, the audit entry survives service restarts and WAL replays.
- Preserve the **opaque payload model** (WAL entries are unparsed LDJSON blobs).
- Maintain **fail-fast behavior** if any DB env var is missing or connection fails.
- Stay consistent with the invariant that **dev == prod**, differing only in environment variable values.

Non-Goals:

- No secondary indexes or analytics schema at this tier.
- No cursor files or WAL replay offsets; replay remains cursorless.
- No batch aggregation or deduplication (handled later by analytics drains).

---

## Decision

Implement `DbAuditWriter` as a class under  
`backend/services/shared/src/writer/DbAuditWriter.ts`.

- Implements `IAuditWriter`.
- Accepts validated `AuditBlob` objects and inserts each as a single document into a MongoDB collection.
- Uses environment variables:
  - `AUDIT_DB_URI`
  - `AUDIT_DB_NAME`
  - `AUDIT_DB_COLLECTION`
- All must be set; **no defaults or fallbacks.** Missing or invalid env values → throw at startup.
- Connection created lazily at first write and cached; one client per service lifetime.
- Collection enforces **insert-only semantics** — no updates, deletes, or upserts.
- FIFO collection naming convention: `<prefix>_fifo` (default `audit_fifo` via env).

Schema (logical, enforced by Zod validation upstream):

```ts
{
  _id: ObjectId,
  service: string,        // producer service slug
  ts: number,             // epoch ms
  requestId: string,      // request correlation id
  blob: unknown,          // opaque payload
}
```

A side-effect registration module `DbAuditWriter.register.ts` exports a single default async function to register this writer with `WriterRegistry`.

---

## Consequences

- **Pros**
  - WAL durability now extends beyond disk into persistent DB storage.
  - Enables later drains and analytics stages to consume from Mongo safely.
  - Follows the same dynamic-import pattern as other writers, avoiding regression risk.
  - Fully adheres to environment invariance and dev==prod parity.

- **Cons**
  - Adds external dependency (MongoDB) to Audit service runtime.
  - Requires explicit teardown on shutdown (`client.close()`).
  - Potentially slower than mock writer under heavy load (acceptable for MVP).

---

## Implementation Notes

- Use official `mongodb` Node.js driver.
- Use a small helper to ensure single connection reuse.
- Writer should be ≤150 lines; any utility extracted into `shared/src/utils/db/MongoConnection.ts`.
- Insert via `collection.insertOne()`; no retry logic — upstream WAL replay handles transient failures.
- `AuditApp` dynamically loads the register file via `AUDIT_WRITER_REGISTER`.
- Test with smoke #11: WAL → DB → document count verification.

---

## Alternatives

1. **Direct DB write from controller:**  
   Violates modular WAL architecture; rejected.
2. **Buffered bulk insert writer:**  
   Adds complexity and latency; deferred until post-MVP optimization.
3. **Different datastore (Postgres, Redis, etc.):**  
   Mongo chosen for simplicity and existing service stack parity.

---

## References

- ADR-0022 — Shared WAL & DB Base  
- ADR-0024 — Audit WAL Persistence Guarantee  
- ADR-0025 — Opaque Payloads & Writer Injection  
- SOP — Backend Architecture (Reduced, Clean)
