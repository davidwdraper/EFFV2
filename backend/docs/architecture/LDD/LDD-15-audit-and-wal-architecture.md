# LDD-15 — Audit & WAL Architecture  
*(Write-Ahead Logging, Replay Semantics, Idempotency, Handler Hooks)*

## 1. Purpose

The Audit/WAL subsystem provides NV with a deterministic, append-only record of all domain mutations.  
This chapter documents:

- WAL architecture and goals  
- Audit entry structure  
- Handler integration points  
- Commit sequence (WAL → DB)  
- Replay semantics  
- Idempotency guarantees  
- Error handling  
- Future evolution (cross-service WAL, KMS signing, retention & shipping)  

---

## 2. Why WAL Exists

1. **Indelible audit trail**  
   Every mutation—create, update, delete—is recorded before it hits Mongo.

2. **Deterministic recovery**  
   WAL can rebuild collections after catastrophic DB loss.

3. **Traceability**  
   WAL ties domain changes to requestId, dtoType, userId (future), timestamps.

4. **Debugging superpower**  
   With WAL, you can “time travel” through the system.

---

## 3. WAL Entry Structure

Example:

```
{
  id: "<uuid>",
  ts: "<RFC3339 timestamp>",
  requestId: "<reqId>",
  service: "<slug>",
  version: <major>,
  dtoType: "<type>",
  operation: "create" | "update" | "delete",
  before: { ...dtoJson? },
  after: { ...dtoJson? },
  actorUserId: "<future>",
}
```

### 3.1 Invariants
- `id` is unique.
- `before` is null for create.
- `after` is null for delete.
- DTOs stored are plain JSON, validated.
- No secrets, ever.

---

## 4. WAL Commit Flow

Standard mutation pipeline:

```
BagPopulatePut → EnforceSingleton → PrepareAudit → BagToDb → Finalize
```

### 4.1 PrepareAudit Handler
- Reads existing DTO (update/delete)
- Reads patched DTO
- Creates audit entry `{before, after}`
- Pushes into `ctx["audit"]`

### 4.2 FlushAudit Handler (final)
- Writes batch of audit entries to WAL store
- Must run before DbWriter
- Must be atomic relative to db writes

---

## 5. Storage Model

WAL is stored in Mongo (current phase).

Collection: `"audit-log"`

Indexes:
- `{ id:1 } unique`
- `{ ts:1 }`
- `{ requestId:1 }`
- `{ operation:1 }`
- `{ service:1, dtoType:1 }`

---

## 6. Idempotency & Ordering

### 6.1 WAL-first
DB writes occur **after** WAL entries are appended.  
If DB write fails, WAL entry persists but marked as “uncommitted” (future).

### 6.2 Idempotent Replay
- replay must detect committed vs uncommitted entries  
- uncommitted → apply DB write  
- committed → skip  

### 6.3 Ordering
- WAL entries must be strictly append-only  
- No updates or deletes  

---

## 7. WAL Replay Engine

Future CLI:

```
nv wal replay --from <ts>
```

Replay steps:
1. Read WAL entries in timestamp order  
2. For each entry, detect if DB mutation exists  
3. If missing → apply mutation  
4. Log result  

---

## 8. Error Handling

WAL errors must be treated as **critical**:
- boot must fail if WAL collection is unavailable  
- write failures → 500  
- replay errors → abort replay  

No silent suppression.

---

## 9. Logging Requirements

WAL writes log:

```
{
  event: "wal_write",
  id, requestId, service, dtoType, operation
}
```

Replay logs:

```
{ event:"wal_replay", id, status }
```

WAL logs must never include:
- secrets  
- full DTO dumps (only before/after as JSON)  

---

## 10. Future Evolution

- KMS-signed WAL entries  
- immutable append-only ledger (S3 + glacier retention)  
- cross-service WAL merging  
- real actor identity  
- compression + batching  
- streaming WAL to analytics pipeline  

---

End of LDD-15.
