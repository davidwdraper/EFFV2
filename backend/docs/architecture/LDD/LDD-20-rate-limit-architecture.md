# LDD-20 — Rate Limiting, Throttling & Abuse Protection  
(Gateway-Level, Service-Level, S2S-Aware)

---

## 1. Purpose
This chapter defines the *defensive rails* that protect NV infrastructure against:
- abusive clients  
- accidental floods  
- botnets  
- runaway internal callers  
- tight polling loops  
- cheap infinite retries  

Rate limiting is not “nice to have”; it is the difference between a stable cluster and a smoking crater.

---

## 2. Placement Philosophy

Rate limiting must occur in **three distinct layers**, each with separate goals:

### 2.1 Layer 1 — Gateway (Public)
Primary shield.  
Protects NV from:
- mobile app misuse  
- external bots  
- load spikes  
- DDOS attempts (light-to-medium)

Handles:
- IP+UserAgent rate limits  
- per-path weight (e.g., create > read)  
- burst bucket + refill  

### 2.2 Layer 2 — Service-Level (Internal Consumer Control)
Guards specific hot endpoints such as:
- `/create`  
- `/update`  
- `/list?cursor=...`  

Prevents:
- front-end bugs from hammering a single route  
- unbounded concurrency inside CRUD services  
- expensive pipelines from saturating resources  

### 2.3 Layer 3 — S2S (Internal Call Discipline)
Prevents:
- a service accidentally calling another in a loop  
- exponential fan-out from a buggy service  
- misconfigured retry policies  

Uses:
- per-slugKey token bucket  
- global S2S QPS ceiling  
- circuit-breaker fallback

---

## 3. L1 Gateway Rate Limiting

### 3.1 Strategy
- Token bucket  
- Limits chosen per environment  
- Uses IP + user identity (if logged in)  
- Stronger limits for anonymous traffic

### 3.2 Burst Rules
- Allow brief bursts (2–4× steady-state)
- Auto-block if >10× steady-state in a 5s window

### 3.3 Cost Model
Each route has a weight:
| Route | Cost |
|-------|------|
| GET /list | 1 |
| GET /read/:id | 1 |
| PUT /create | 5 |
| PATCH /update | 3 |
| DELETE /delete | 3 |

Higher cost = consumes more tokens.

### 3.4 Client Feedback
429 responses use Problem+JSON:
```
{
  "title": "Too Many Requests",
  "detail": "Rate limit exceeded",
  "code": "RATE_LIMIT",
  "status": 429,
  "retryAfter": "<seconds>",
  "requestId": "..."
}
```

---

## 4. L2 Service-Level Throttles

### 4.1 Per-route concurrency caps
Example:
- max 10 concurrent creates  
- max 50 concurrent reads  

If exceeded:
- queue up to N  
- reject beyond N with 503

### 4.2 Backpressure
When DB latency increases:
- service reduces concurrency  
- increases internal cooldown  
- sends contamination signal to gateway (future)

---

## 5. L3 S2S Rate Limiting

### 5.1 Per-target token pools
Each slugKey gets:
- steady QPS  
- burst pool  
- rejection if exceeded

### 5.2 Retry Discipline
SvcClient future roadmap enforces:
- exponential backoff  
- jitter  
- max retry budget per requestId  

### 5.3 Loop Detection
SvcClient detects patterns:
```
A → B → A → B → A
```
If seen:
- abort  
- send SECURITY log  
- increment loop counter  
- alert operator

---

## 6. Circuit Breakers

### 6.1 Per-Target
If service X times out > N times in 30s:
- open breaker  
- fail fast for future calls  
- retry half-open after cooldown  

### 6.2 Global Breaker
Triggered by:
- DB saturation  
- network partition  
- sudden latency spike  

Prevents cluster death spirals.

---

## 7. Abuse Detection

### 7.1 Gateway patterns
- rotating IP floods  
- identical header fingerprints  
- repeated 404s  
- scraping attempts  

### 7.2 Service patterns
- repeated invalid DTOs  
- brute-force invalid ids  
- failed create/update attempts  
- pathological pagination patterns  

Malicious users are quietly degraded first, blocked second.

---

## 8. Operator Guidance

### 8.1 Over-limit events
Operators check:
- gateway logs  
- route cost table  
- incoming spike pattern  
- svcconfig targets healthy?  

### 8.2 Troubleshooting loops
- inspect WAL for repeated requestId patterns  
- check SvcClient logs  
- verify no pipelines are calling each other inadvertently  

### 8.3 Dynamic Tuning
Limits vary by environment:
- dev: low  
- stage: realistic  
- prod: tuned via real metrics  

---

## 9. Future roadmap
- ML-based anomaly scoring  
- per-user 90‑day behavior profile  
- Burst detection heuristics tuned from real traffic  
- Multi-region rate coordination  
- Redis/KeyDB cluster integration  
