# LDD-19 — S2S Protocol Architecture  
(Service‑to‑Service Calls, Required Headers, Envelope Rules, Future JWT Rails)

---

## 1. Purpose
Define the canonical protocol that governs **all internal NV service-to-service (S2S) communication**, including:
- Routing (slugKey → svcconfig → URL)
- Required request headers
- Envelope format
- Error semantics
- RequestId propagation
- Future JWT-based authentication
- Deterministic behavior across all NV services

This chapter is the blueprint for replacing SvcClient’s mock routing with real svcconfig-backed routing.

---

## 2. S2S Principles

1. **Single S2S door**  
   Every S2S call goes through the `SvcClient.call(slugKey, opts)` API — no exceptions.

2. **SlugKey-based routing**  
   - Form: `<slug>@<majorVersion>`  
   - Example: `env-service@1`  
   - Version determines API contract, not deployment.

3. **Deterministic Headers**  
   All S2S requests must include:
   - `x-service-name`: caller slug  
   - `x-api-version`: caller version  
   - `x-request-id`: propagated from upstream

4. **Strict separation**  
   - *Public clients* hit **Gateway**  
   - *Internal services* communicate via **S2S protocol**  
   - Gateway never forwards client Authorization headers.

5. **DTO-first correctness**  
   Wire content = DTO JSON, never nested `"doc"` wrappers.

6. **Environment isolation**  
   Routing is environment-bound via svcconfig (dev/stage/prod).

---

## 3. S2S Headers (Required)

### 3.1 Required
| Header | Description |
|-------|-------------|
| **x-service-name** | Slug of the service making the call |
| **x-api-version** | Major version of caller |
| **x-request-id** | End-to-end request identifier |
| **content-type** | Present if bodyJson exists |

### 3.2 Future (JWT)
| Header | Description |
|--------|-------------|
| **authorization** | `Bearer <JWT>` minted for the call (future) |

JWT will encode:
- caller slug  
- caller version  
- issued-at  
- expiry  
- allowable target slugs  

---

## 4. SvcClient Routing Model

### 4.1 Current (mock)
A static in-memory map:
```ts
{
  "env-service@1": "http://127.0.0.1:4015",
  "xxx@1": "http://127.0.0.1:4016"
}
```
This is temporary.

### 4.2 Future (svcconfig-backed)
Flow:
```
slugKey → svcconfig → { protocol, host, port } → URL
```

### 4.3 Refresh rules
- SvcClient caches results.
- Refresh triggered on:
  - 404 from svcconfig entry
  - 500-level routing errors
  - Reload intervals (configurable)

### 4.4 Hard invariants
- If svcconfig cannot resolve a slugKey → **fail-fast**.
- Never guess a URL.
- Never fallback to mock once real svcconfig is deployed.

---

## 5. Envelope Format (Wire Contract)

### 5.1 Requests
Body (if present) is JSON created by:
```
Dto.toJson()
```

### 5.2 Responses
All services return:

```
{
  items: [ … DTO JSON … ],
  meta: {
    limit?: number,
    cursor?: string,
    count?: number,
    ...future
  }
}
```

No nested `"doc"` fields.  
DTO is fully JSON-serializable.

---

## 6. RequestId Semantics

### 6.1 Rules
- Gateway creates requestId if missing.
- Every service **must** propagate it.
- SvcClient includes it automatically.
- Controllers seed it into HandlerContext.

### 6.2 Failure mode
If a service generates a new requestId internally → **bug**.

---

## 7. Error Propagation

### 7.1 All errors surface as Problem+JSON
Regardless of hop count:
```
client → gateway → service → svcconfig → service
```

### 7.2 4xx vs 5xx rules
- Handler/DTO errors → 4xx  
- Internal/persistence errors → 5xx  
- Duplicate key errors → normalized across chain  

### 7.3 SvcClient behavior
SvcClient surfaces:
- network errors
- parse errors
- non-2xx responses

Handlers/controllers decide final Problem+JSON mapping.

---

## 8. Security Architecture (Future)

### 8.1 Service Identity via JWT
SvcClient will mint a signed JWT using:
- KMS signing key
- service slug
- version
- issuance timestamp
- short TTL

Target service verifies:
- signature
- audience
- issuer
- slug/versions permitted
- expiration window

### 8.2 Replay prevention
Replay detection performed via:
- requestId uniqueness + WAL  
- JWT jti fields (future)

### 8.3 Optional mTLS extension
Possible for inter-region S2S communication.

---

## 9. Operator Guidance

### 9.1 When S2S routing fails
- Check svcconfig record for slugKey.
- Validate NV_ENV for the calling service.
- Check index hints in svcconfig.

### 9.2 When signatures fail (future)
- Clock skew too large  
- Expired tokens  
- Wrong audience/issuer  

### 9.3 Debugging
Enable SvcClient debug mode:
```
NV_SVCCLIENT_DEBUG=true
```

---

## 10. Future Enhancements

- Automatic retry-on-transient 503 with exponential backoff.
- Tracing headers (traceId, parentSpanId).
- Circuit breakers per target service.
- Bulk routing prefetch for performance.
- Full JWT rollout + key rotation.
