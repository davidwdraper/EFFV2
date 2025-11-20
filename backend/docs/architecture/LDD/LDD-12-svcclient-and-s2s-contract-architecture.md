# LDD-12 — SvcClient & S2S Contract Architecture (Full Deep Dive)

## 1. Purpose

SvcClient is the single, canonical door for all service‑to‑service (S2S) communication in NV’s backend.  
This chapter defines:

- SvcClient call flow  
- slugKey (`<slug>@<version>`) resolution  
- mandatory S2S headers  
- requestId propagation  
- error normalization  
- routing rules and future svcconfig integration  
- preparatory rails for JWT-based authorization  
- SvcEnvClient architecture as an applied case  

---

## 2. Architectural Goals

1. **One S2S entry point** — every inter-service call flows through SvcClient.  
2. **Deterministic routing** — slugKey → base URL resolution is explicit, not reflective.  
3. **Future-proofing** — built to introduce JWT, KMS, mTLS, rate-limits, replay-protection.  
4. **Wire-level purity** — SvcClient deals only in plain JSON, no DTOs.  
5. **Zero environment drift** — no `process.env` reads here (except mandatory initial NV_ENV in SvcEnvClient).  
6. **Observability** — each call must include requestId and structured logs.

---

## 3. SvcClient Call Flow

### 3.1 Inputs

```
call(slugKey, {
  method,
  path,
  query,
  bodyJson,
  headers,
  requestId,
})
```

Where:  
- `slugKey` = "<slug>@<version>"  
- `method` = GET | POST | PUT | PATCH | DELETE  
- `path` must start with "/"  
- `query` is a dictionary of primitives  
- `bodyJson` is raw JSON, not DTOs  

### 3.2 Pipeline

1. **Validate slugKey**  
2. **Parse slug + version**  
3. **Resolve base URL**  
4. **Construct full URL** (query params included)  
5. **Add standard headers**  
6. **Perform fetch()**  
7. **Parse JSON safely**  
8. **Return unified response object**  

---

## 4. slugKey Resolution

slugKey format:
```
<slug>@<version>
```

### 4.1 Invariants
- Must contain exactly one "@"  
- `<slug>` cannot be empty  
- `<version>` must be numeric  
- Unknown slugKey → error (until svcconfig comes online)

### 4.2 Future Model (svcconfig-backed)
Once svcconfig launches:
- each service will dynamically fetch routing metadata
- SvcClient.resolveBaseUrl() becomes dynamic
- fallback mock table is removed entirely

---

## 5. Mandatory S2S Headers

SvcClient injects the following headers on every call:

```
x-service-name: <callerSlug>
x-api-version: <callerVersion>
x-request-id: <requestId>
content-type: application/json   (if body)
```

### 5.1 Invariants
- requestId MUST be present  
- callerSlug/version MUST match the current service’s identity  
- Services must trust only S2S calls with JWT (future)  

---

## 6. requestId Propagation

SvcClient never generates requestIds.  
Controllers or upstream clients generate them.

Propagation chain:
- inbound HTTP → controller → ctx["requestId"] → SvcClient → target service logs → target pipeline → target finalize()

### 6.1 Why it matters
- enables multi-service traceability  
- allows audit/WAL correlation  
- prevents “orphan” logs  

---

## 7. Error Normalization

SvcClient classifies errors into:

### 7.1 Network Errors
```
SVC_CLIENT_NETWORK_ERROR
```
Occurs before receiving any HTTP response.

### 7.2 Invalid JSON Errors
```
SVC_CLIENT_JSON_PARSE_ERROR
```

### 7.3 Bad SlugKey
```
SVC_CLIENT_INVALID_SLUGKEY
```

### 7.4 Unknown SlugKey (mock mode)
```
SVC_CLIENT_MOCK_UNKNOWN_TARGET
```

### 7.5 Response Parsing
Non-JSON content yields:
```
{ _nonJson: true, text: "<body>" }
```

---

## 8. Body & Query Semantics

### 8.1 Body Rules
- Must be JSON serializable  
- Must NOT be DTOs  
- SvcClient never mutates bodyJson  

### 8.2 Query Rules
- Values converted to strings  
- Undefined keys skipped  
- Order not guaranteed  

---

## 9. SvcEnvClient — Applied Case Study

SvcEnvClient is a thin wrapper over SvcClient with two responsibilities:

1. Resolve current NV_ENV (v1: reads process.env)  
2. Fetch config bags from env-service:

```
GET /api/env-service/v1/env-service/config?env=<env>&slug=<slug>&version=<v>
```

### 9.1 Response Shape
```
{
  items: [ <EnvServiceDto JSON> ],
  meta: { ... }?
}
```

### 9.2 Hydration Discipline
SvcEnvClient must:
- validate array  
- map items → EnvServiceDto.fromJson(item, { validate:true })  
- wrap in DtoBag  
- reject empty bags  

---

## 10. Future JWT Integration

SvcClient will be extended to include:
- `Authorization: Bearer <JWT>`  
- JWT signed via KMS  
- Claims:
  - iss = caller service  
  - aud = target service slug  
  - sub = requestId  
  - svcVersion  
  - timestamp + anti-replay nonce  

### 10.1 Invariants
- no service may accept S2S traffic without JWT  
- SvcClient will mint tokens per request  
- token TTL must be short (<60 seconds)  
- KMS keys rotated regularly  

---

## 11. svcconfig Integration (Post-Mock Era)

Once svcconfig is live:

### 11.1 SvcClient.resolveBaseUrl() becomes:
```
GET /api/svcconfig/v1/resolve/<slug>@<version>
→ { url:"http://host:port" }
```

### 11.2 Benefits
- no more mock table  
- dynamic routing  
- hot reconfiguration via envReloader  
- rolling deploy of new versions  

---

## 12. Multi-Hop S2S Relay (Gateway → Auth → User)

SvcClient enables deep routing chains:

1. Client → Gateway  
2. Gateway (SvcClient) → Auth  
3. Auth (SvcClient) → User  

### 12.1 Safety rails
- Gateway must never forward client Authorization header  
- Each hop gets a new SvcClient-bound JWT (future)  
- requestId remains constant  

---

## 13. Logging Requirements

SvcClient logs:
- slugKey  
- final URL  
- method  
- requestId  
- status code  
- network errors  
- malformed responses  

No logs may contain:
- secrets  
- DTOs  
- env variables from env-service  

---

## 14. Timeouts (Future)

SvcClient will add:
- per-call timeoutMs  
- abort controller-level pipelines if exceeded  
- timeout → 504 Gateway Timeout downstream  

---

## 15. Testing Requirements

Smoke tests rely on:
- deterministic mock table  
- static port mapping  
- no fallback URLs  
- stable requestId propagation

Integration tests will later validate:
- JWT presence  
- svcconfig lookup behavior  
- S2S signature verification  

---

## 16. Future Extensions

- Automatic retries for idempotent GETs  
- Circuit breakers  
- Rate limiting  
- Connection pooling  
- Observability spans for each call  

---

End of LDD-12.
