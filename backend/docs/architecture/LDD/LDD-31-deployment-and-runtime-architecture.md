# LDD‑31 — Deployment & Runtime Architecture  
*(Service Boot, Health, Process Model, Scaling, and Operator Expectations)*

---

## 1. Purpose

This chapter documents NV’s **deployment, runtime, and operational architecture**, answering:

- How services boot and validate their environment  
- How health checks work (local + gateway + mesh)  
- How services run in local/dev/prod  
- How scaling, rolling upgrades, and process isolation work  
- How failures are detected and surfaced to operators  
- How services coordinate with env-service and svcconfig

This complements LDD‑19 (Boot & SvcClient) and LDD‑25 (Gateway Architecture).

---

## 2. Runtime Model

Each NV service runs as a **single-process Node runtime**, responsible for:

- loading env from env-service  
- warming svcconfig (if not env-service itself)  
- building an in-memory routing table (gateway only)  
- creating an HTTP server  
- mounting health endpoints before any middleware  
- mounting auth (if applicable)  
- mounting all CRUD routes  
- exposing readiness/liveness status  

### 2.1 No Multi-Process Clustering (v1)
Clustering (Node PM2/cluster mode) is avoided because:

- WAL/Audit writers should not multiplex across processes  
- operator debugging is cleaner with single-process instances  
- horizontal scaling handles throughput better  

Clustering can be added in v3+ with WAL/Audit sequence guarantees.

---

## 3. Boot Sequence (Non‑Gateway Services)

All services follow this boot sequence:

```
1. start process
2. load SvcEnvClient (envBootstrap)
3. resolve own env vars (NV_HTTP_HOST, NV_HTTP_PORT, DB vars)
4. preflight all required env keys
5. connect to Mongo (DbClient)
6. build registry (DTOs + indexHints)
7. ensureIndexesForDtos()
8. warm SvcClient (optional)
9. mount health route
10. mount S2S JWT verify (if required)
11. mount JSON/body parser
12. mount routes
13. listen()
```

If *anything* fails before step 13, the service **must not** start.

---

## 4. Boot Sequence (Gateway)

Gateway adds more:

```
1–8 same as above
9. preload svcconfig (routing table)
10. build slug@version → URL map
11. mount health first
12. mount requestId generator
13. mount rate limiting (LDD‑20)
14. mount auth (client JWT or introspection)
15. mount proxy routes (dynamic via svcconfig)
16. listen()
```

If svcconfig cannot be loaded → **fail-fast**.

---

## 5. Health Architecture

### 5.1 Local Service Health
Every service exposes:

```
GET /api/<slug>/health
→ { ok: true, slug, version, env, mongo: "ok"|"fail", timestamp }
```

Mounted **before any auth or JSON parsing**, per LDD‑13.

### 5.2 Gateway Health
Gateway exposes:

- `GET /api/gateway/health`  
- `GET /api/gateway/health/mesh` (future v2)

Mesh health fans out to public services via svcconfig.

### 5.3 Liveness vs Readiness

- **liveness**: process is alive  
- **readiness**: process is fully booted (DB ok, env ok, svcconfig ok)

Both must succeed before the gateway includes a service in routing.

---

## 6. Scaling Model

### 6.1 Horizontal Scaling
Services are horizontally scalable:

- multiple replicas of each service  
- gateway load-balances via platform (K8s/EC2/containers)  
- svcconfig points to load balancer *or* direct host/port for small deployments  

### 6.2 Vertical Scaling
Services are lightweight and CPU-bound primarily on:

- JSON validation  
- DTO creation  
- signature verification  
- SVC calls  

NV uses minimal memory (<200MB per service typical).

### 6.3 Stateless Design
All state lives in Mongo.  
Service instances are stateless, except:

- in-memory caches (short-lived)  
- routing tables (gateway only)

---

## 7. Rolling Deployments

### 7.1 Process
```
Deploy v2 → Register in svcconfig → Gateway exposes both → Drain v1 → Terminate v1.
```

### 7.2 Draining
During draining:

- new requests routed to v2  
- in-flight v1 requests are allowed to finish  
- once idle, v1 pod is terminated  

### 7.3 WAL/Audit Concerns
Because WAL/Audit is per-instance:

- WAL entries must flush before shutdown  
- system must ensure no WAL record is stranded during pod termination  

This is handled by “preStop” hooks (container) or SIGTERM listener.

---

## 8. Failure Handling

### 8.1 Boot Failures
Service must not start if:

- Mongo unreachable  
- env-service unreachable  
- svcconfig unreachable (gateway)  
- missing env keys  
- index enforcement fails  
- registry undefined  

### 8.2 Runtime Failures
Services surface:

- 503 (DB unavailable)  
- 502 (upstream unreachable — gateway only)  
- 500 (unexpected)  

All with Problem+JSON and `requestId`.

### 8.3 Self-Healing
Container runtime restarts crashed services automatically.

---

## 9. Logging & Observability

Each service logs:

- boot checkpoint logs (“INIT → DB OK → REGISTRY OK → LISTENING”)  
- request logs (method, url, status, duration, requestId)  
- SVC call logs (slug@ver, duration, status)  
- WAL/Audit events (summaries only)  
- warnings and errors (operator guidance only)  

Distributed tracing (future v3) will add:

- spanIds  
- cross-service correlation  
- sampling rules  

---

## 10. Configuration Flow (env-service + svcconfig)

### 10.1 env-service
Provides:
- DB uri/name  
- HTTP host/port  
- service-specific keys (auth TTL, credit config, etc.)

### 10.2 svcconfig
Provides:
- topology for all services  
- target URLs for SvcClient  
- version routing for gateway  

### 10.3 Combined Boot Logic

```
env-service → envBootstrap → load envDto
svcconfig → routing (gateway only)
service → ensureIndexesForDtos
service → listen()
```

---

## 11. Runtime Caching

### 11.1 Allowed

- routing tables (gateway)  
- small LRU caches (<500 entries)  
- per-request memoization  
- DTO constructors (precompiled zod schemas)  

### 11.2 Not Allowed

- long-lived application caches  
- persistent in-memory indexes  
- cross-instance caches  
- caching DB reads for business data  

Caching is restricted to behavior rails, not business logic.

---

## 12. Run Modes

### 12.1 Local Mode (dev)
- http only  
- verbose logs  
- no rate limits  
- WAL uses MockWriter  
- svcconfig optional (can be stubbed)

### 12.2 Test Mode (smokes)
- deterministic host/port  
- fixed seed data  
- WAL/Audit output tested via mock  
- no external network calls except svcconfig/env-service

### 12.3 Staging/Production
- https enforced  
- real WAL+Audit  
- svcconfig required  
- Multi-replica scaling  
- resource limits enforced

---

## 13. Deployment Anti‑Patterns

- ❌ starting gateway without svcconfig  
- ❌ bypassing envBootstrap  
- ❌ multiple concurrent WAL writers inside a single service  
- ❌ caching DB state for business logic  
- ❌ skipping ensureIndexesForDtos  
- ❌ running without requestId propagation  
- ❌ leaking stack traces in responses  

---

## 14. Operator Checklist

Before promoting a service:

- [ ] Health OK  
- [ ] DB reachable  
- [ ] Env OK  
- [ ] svcconfig OK (gateway only)  
- [ ] WAL+Audit OK  
- [ ] Logs clean  
- [ ] Smokes all green  
- [ ] Versioning (LDD‑30) validated  
- [ ] Deployment plan approved  

---

## 15. Future Enhancements

### v2
- hot-reload svcconfig  
- prewarming services for zero-impact restarts  
- graceful SIGTERM with WAL flush  

### v3
- mesh-level health aggregator  
- distributed tracing  
- canary routing  

### v4
- predictive autoscaling  
- multi-region load balancing  
- service graph dashboards  

---

End of LDD‑31.
