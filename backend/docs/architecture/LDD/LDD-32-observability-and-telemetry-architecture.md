# LDD‑32 — Observability & Telemetry Architecture  
*(Logging, Metrics, Tracing, Dashboards, and Operator Insight)*

---

## 1. Purpose

Observability is the backbone of “find the bug before the customer finds you.”  
NV’s mesh must expose **logs**, **metrics**, and eventually **distributed traces** that allow operators to:

- pinpoint bottlenecks,  
- detect failures early,  
- measure real‑time service health,  
- understand SVC call patterns,  
- correlate events across gateway → services → DB → WAL/Audit.

This LDD defines the unified observability architecture for all NV services.

---

## 2. Core Principles

### 2.1 Predictable Logs, Everywhere
Every service logs the **same fields**, in the **same format**, using the **same logger rail**.

### 2.2 No Silence
Every inbound request, outbound SVC call, WAL write, and DB write must produce logs.

### 2.3 Operator‑First Semantics
Logs are written for humans who must debug production at 3 AM.

### 2.4 Privacy & Security
Sensitive data (tokens, hashes, secrets) must never appear in logs.

---

## 3. Logging Architecture

### 3.1 Logger Rail
Every service uses the shared `logger.ts` utility:

- wraps Pino  
- injects:
  - timestamp  
  - service slug/version  
  - requestId  
  - severity  
  - subsystem  
  - error codes  

### 3.2 Log Types

1. **Startup logs**  
   - “INIT → DB OK → REGISTRY OK → LISTENING”

2. **HTTP request logs**  
   ```
   [REQ] method=PUT path=/api/xxx/v1/... status=200 duration=17ms requestId=abcd
   ```

3. **SVC call logs**  
   ```
   [SVC] target=auth@1 method=POST path=/... status=200 duration=12ms
   ```

4. **DB logs**  
   ```
   [DB] op=insert dtoType=xxx id=123 duration=5ms
   ```

5. **WAL/Audit logs** (summaries only)  
   ```
   [WAL] op=create dtoType=xxx id=123
   ```

6. **Warnings & Errors**  
   ```
   [ERR] code=DB_UNAVAILABLE detail="Mongo timeout" requestId=abcd
   ```

### 3.3 Logging Anti‑Patterns

- ❌ logging entire inbound JSON bodies  
- ❌ logging tokens (access/refresh)  
- ❌ logging stack traces to clients  
- ❌ using console.log  

---

## 4. Metrics Architecture

### 4.1 Metrics Philosophy

NV uses a **minimal but high‑value metric set**:

- throughput (requests/sec)  
- error rate  
- latency buckets  
- SVC call durations  
- DB read/write durations  
- WAL/Audit throughput  
- memory/CPU per pod  

### 4.2 Collection Rail

Metrics originate from:

- HTTP middleware (per route)  
- SVCClient wrapper  
- DbWriter/DbReader instrumentation  
- WAL/Audit writer  

### 4.3 Export Strategy

In MVP:
- metrics exported to Prometheus via `/metrics` endpoint  
- collected per-container  
- aggregated by namespace (dev/stage/prod)

In future v3:
- OpenTelemetry metrics  
- histograms + exemplars  
- service-to-service correlation  

---

## 5. Distributed Tracing (Future v3)

While not required in MVP, LDD formalizes the future path.

### 5.1 Span Model

Traces will capture:

- inbound HTTP span  
- pipeline spans (handlers)  
- SVC calls  
- DB operations  
- WAL/Audit writes  

### 5.2 Propagation
Inject through:

- `x-request-id`  
- future: `traceparent` header (W3C)

### 5.3 Sampling Strategy
- 0.1% sampling in production  
- 100% in staging  
- developer override in local

---

## 6. Dashboards

### 6.1 Types of Dashboards

1. **Service Health Dashboard**
   - latency p50/p90/p99
   - error rate
   - CPU/memory
   - DB health
   - WAL/Audit throughput

2. **Gateway Dashboard**
   - SVC call error rate
   - upstream latencies
   - version routing distribution

3. **Mesh Dashboard**
   - dependency graph
   - slowdown hotspots
   - cross-service failures

4. **Auth Dashboard**
   - login success/failure rate
   - token refresh volume
   - revocation events

### 6.2 Alerts

Alerts trigger on:

- DB connection failures  
- svcconfig unreachable  
- spike in 5xx  
- spike in SVC call latency  
- WAL backpressure  
- Auth login failure rate  
- gateway proxy errors  

---

## 7. Correlation Model

Every log, metric, trace MUST contain:

- `requestId`  
- `service`  
- `slug@version`  
- timestamp  

Optional:
- `principal.subjectId` (if auth’d)  
- `dtoType`  
- SVC call `targetSlug@ver`

Correlation enables:

```
client → gateway → auth → svc → db → wal → audit
```

to be traced as a single chain.

---

## 8. Error Visibility & Operator Flow

### 8.1 Operator Timeline (Ideal)

1. alert triggers  
2. operator views dashboard  
3. jumps from dashboard → logs  
4. logs show `requestId`  
5. operator queries all logs with that requestId  
6. walk the service chain using SVC logs  
7. isolate root cause  
8. confirm with metrics  
9. deploy fix / restart service

### 8.2 Operator Guidance in Logs (LDD‑29)
Messages must be actionable, not cryptic.

Examples:
```
ENV_CONFIG_INVALID — NV_MONGO_DB missing. Check env-service.
SVC_CLIENT_UNKNOWN_TARGET — "auth@2" not in svcconfig.
DB_UNAVAILABLE — Check connectivity to cluster.
```

---

## 9. High-Value Event Streams

### 9.1 WAL Stream
Used for reconstructing persistent state during failure scenarios.

### 9.2 Audit Stream
Used for legal/business correctness and user support.

### 9.3 Observability Stream (Future)
Event bus for:

- trace spans  
- error events  
- anomaly detection  

---

## 10. Future Enhancements

### v2
- Structured log schemas in shared  
- Prometheus federation queries  
- request-per-second adaptive rate limits  

### v3
- full OpenTelemetry instrumentation  
- service-to-service flamegraphs  
- distributed context propagation  

### v4
- anomaly detection (ML-based)  
- predictive autoscaling  
- mesh-wide root-cause analysis  

---

End of LDD‑32.
