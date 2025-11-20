# LDD‑27 — WAL & Audit Architecture (Write‑Ahead Logging + Immutable Audit Trail)

## 1. Purpose

The NV backend requires **deterministic, replayable, tamper‑evident persistence**.  
Two rails handle this:

1. **WAL (Write‑Ahead Log)** — ensures writes are durable and recoverable.
2. **Audit Trail** — immutable business‑side record of all mutations.

They share mechanics but serve different missions:
- WAL protects *data integrity*.  
- Audit protects *business and legal correctness*.

Both are required for a production‑grade platform.

---

## 2. Core Principles

### 2.1 WAL Is Mandatory for Every Write
Every DB write (create/update/delete) must:
1. emit a WAL record,
2. flush WAL,
3. apply the DB write.

If DB write fails, WAL entry enables retry or operator recovery.

### 2.2 Audit Is Immutable
Audit entries:
- are append‑only,  
- contain the *semantic meaning* of a change (who, when, why, what),  
- never change or delete,  
- are accessible to operators for reconstructing business outcomes.

### 2.3 WAL and Audit Are Separate Streams
Never merge them:
- WAL: machine‑readable, internal consistency format  
- Audit: human‑readable + machine‑indexable business trail  

---

## 3. WAL Data Model

Each WAL entry is a small JSON structure:

```
id: string (uuid)
service: string
version: number
timestamp: string (ISO)
operation: "create" | "update" | "delete"
dtoType: string
payload: Record<string, unknown>          ← raw bag payload
replayKey: string                         ← deterministic identity
```

### 3.1 ReplayKey
Derived by:
```
env + slug + version + dtoType + entityId
```
This grants idempotent replay.

---

## 4. Audit Data Model

Audit entries include more context:

```
id: string
timestamp: string
service: string
operation: string
userId: string | null
dtoType: string
entityId: string
before: Record<string, unknown> | null
after: Record<string, unknown> | null
reason: string
metadata: Record<string, string>
requestId: string
```

### 4.1 Required Fields
Audit entries *must* contain:
- `requestId`
- `entityId`
- `operation`

---

## 5. Write Flow (Full Diagram)

```
Controller
  → BagPopulate
  → Validation
  → Business Logic (optional)
  → Assemble DTO Bag
  → WAL.emit(bag)
  → WAL.flush()
  → DbWriter.write(bag)
  → Audit.emit(bag, before/after)
  → finalize()
```

### 5.1 Error Conditions
```
WAL.emit fails  → abort (500)
WAL.flush fails → abort (500)
DB write fails  → WAL replay required
Audit emit fails → log error, do NOT abort write
```

---

## 6. WAL Implementation

### 6.1 Writers
NV uses a pluggable writer architecture:

- **MockWriter** — for development; stores entries in-memory.
- **DbWriter** — production writer; targets MongoDB.
- **HttpWriter** — for remote streams (future).

### 6.2 Replay on Boot
Only needed for:
- crash between WAL.flush and DB write  
- legacy cleanup  

Flow:
```
read all WAL entries
for each entry:
    if DB state missing/incomplete:
         reapply write
    mark WAL entry as resolved
```

---

## 7. Audit Architecture

### 7.1 Emission
Audit events are emitted *after* DB writes to ensure correctness but:
- the write succeeds even if audit logging fails,
- audit failures are operator-visible warnings (never fatal).

### 7.2 Categories of Audit Events
- entity-mutation
- authentication
- permission
- system-events
- service-start/stop
- environment-change (env-service)

### 7.3 Search Fields
Audit collection must index:
- `requestId`
- `entityId`
- `service`
- `timestamp`

---

## 8. Integration With DTO‑Only Persistence

Audit + WAL operate on:
- the DTO instance,
- its toJson() output,
- the DtoBag around it.

DTO defines:
- canonical id,
- index hints,
- serialization format.

Thus WAL and audit are immune to underlying DB model shifts.

---

## 9. SvcEnv & Config Flow

WAL and Audit both use:
```
svcEnv.getEnvVar("NV_MONGO_URI")
svcEnv.getEnvVar("NV_MONGO_DB")
```

No `.env` files unless in local development.

---

## 10. Error Surfaces & Operator Guidance

### 10.1 WAL Failures
- Immediate 500  
- Log guidance including:
  - WAL writer type
  - payload summary
  - suggested operator steps

### 10.2 DB Write Failures
Return:
```
Problem+json (409 or 500 depending on type)
```
Then WAL replay will handle reconstruction.

### 10.3 Audit Failures
- Not fatal  
- Logged with severity WARN  
- Include dtoType, op, entityId, requestId  

---

## 11. Testing Guidance

### 11.1 Unit
- WAL emit/flush logic  
- DTO serialization  
- ReplayKey generation  

### 11.2 Integration
- WAL+DB sequencing  
- Crash simulation  
- Replay correctness  

### 11.3 Smoke
- Verify WAL acceptance  
- Verify DbWriter writes  
- Verify replay recovers lost writes  

---

## 12. Future Enhancements

### v2
- encrypted audit trail
- WAL rotation
- WAL compression
- parallelizable WAL processing

### v3
- remote audit sinks  
- cross-region replication  
- no‑downtime WAL + DB migrations  

### v4
- blockchain-style hash linking (tamper detection)  
- cryptographic attestation for audit logs  

