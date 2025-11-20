# LDD-11 — Logging, Observability & Audit Discipline (Full Deep Dive)

## 1. Purpose

This chapter defines the unified logging, observability, and audit rules that apply across all NV backend services.  
It covers:

- requestId lifecycle  
- structured logging requirements  
- per-layer logging responsibilities  
- audit discipline and future WAL integration  
- error logging consistency  
- log routing (security vs ops vs app)  
- observability invariants  

---

## 2. requestId — The Spine of Observability

Every operation is traceable only if requestId flows end-to-end.

### 2.1 Inbound Rules
- If the client provides `x-request-id`, use it.
- If absent, generate a random base36 ID.
- Must be placed into `ctx["requestId"]` immediately.
- Must be echoed in:
  - logs
  - errors
  - health responses
  - write operations
  - cross-service calls (future JWT)

### 2.2 Invariants
- Controllers MUST NOT reassign requestId.
- Handlers must pass requestId through unchanged.
- Duplicate logs without requestId are forbidden.

---

## 3. Logging Layers

### 3.1 AppBase-Level Logs
- boot start  
- envBootstrap results  
- index ensure lifecycle  
- route mount  
- startup errors  

All AppBase logs must include:  
`{ service, version, requestId? (optional at boot) }`

---

### 3.2 Controller-Level Logs
Controllers log:

- construction  
- makeContext  
- pipeline selection  
- missing dtoType/id errors  
- finalization entry/exit  
- client error responses  
- internal error responses  

Invariants:
- no DTO data dumped  
- logs must never contain secrets  
- logs should contain enough Ops detail to diagnose  

---

### 3.3 Pipeline & Handler-Level Logs

Handlers log:
- entry  
- exit  
- any error before setting handlerStatus="error"  

Each entry must include:
```
{ handler: <name>, requestId, op, dtoType }
```

Each error must include:
```
{ handler, requestId, err: err.message }
```

Pipeline selection logs must come from controllers, not handlers.

---

## 4. Error Logging & Problem+JSON Logging Discipline

Errors are logged once at controller finalization.

### 4.1 Categories
- **finalize_client_error** → 4xx  
- **finalize_error** → 5xx  

### 4.2 Required Fields
All errors must log:
```
{ event, requestId, status, problem }
```

### 4.3 DTO Dumping Forbidden
Logs must never include:
- entire DTO JSON
- bag contents  
- environment configs  
- secrets  

Only surface-level context is allowed.

---

## 5. Observability Layers

### 5.1 pino-http / structured logging
- all logs must be JSON  
- timestamped  
- contain service & version  
- combined with requestId  

### 5.2 Log Routing
Types of logs:
- **security** → auth events, S2S verification  
- **audit** → domain writes (WAL)  
- **app** → service-specific events  
- **ops** → boot, configuration, index creation  

Future:
- separate streams per logger  
- rotate + upload to cloud  

---

## 6. WAL & Audit Discipline (Forward-Looking)

WAL (Write-Ahead Log) will record:
- DTO mutations  
- actor userId (mocked for now)  
- timestamp  
- service + dtoType  
- before/after snapshots (diffable)

### 6.1 Invariants
- controllers never write WAL directly  
- handlers emit audit entries into ctx["audit"]  
- audit flush happens once per request  
- db writes must occur **after** WAL entries are prepared  

### 6.2 WAL Safety Rules
- do not log secrets  
- WAL must be append-only  
- WAL must be idempotent on retries  

---

## 7. Cross-Service Observability (Future JWT Era)

SvcClient will eventually include:
- JWT minting w/ requestId claims  
- distributed tracing metadata  
- log correlation across services  

### 7.1 Invariants
- requestId becomes mandatory for all S2S calls  
- no service may drop requestId  
- logs across multiple services must join cleanly  

---

## 8. Metrics (Future Extension)

When metrics are introduced:
- rate counters for each route/op  
- error counters  
- latency histograms (per route and per handler)  
- DB read/write latency metrics  
- WAL flush latency metrics  

Metrics must never exceed 1% overhead.

---

## 9. Redaction Rules

Redact:
- email  
- phone  
- passwords  
- env-service variables (except NV_HTTP_HOST/PORT)  
- JWTs  
- raw DB errors (surface only normalized details)  

Do not redact:
- dtoType  
- id  
- collectionName  
- index names  
- requestId  

---

## 10. Future Observability Extensions

- OpenTelemetry integration  
- Full tracing with parent/span IDs  
- Slow-query warnings (DB)  
- High-latency pipeline alerts  
- Per-handler execution timing  

---

End of LDD-11.
