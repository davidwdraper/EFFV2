# LDD-14 — Gateway Architecture  
*(Public Entry, S2S Dispatch, Route Stripping, Security Rails)*

## 1. Purpose

The Gateway is NV’s **only** public-facing HTTP surface.  
This chapter defines:

- gateway boot rules  
- inbound request handling  
- client → gateway → service dispatch  
- route stripping semantics  
- S2S forwarding contract  
- required headers (requestId, x-service-name, x-api-version)  
- strict security rails (no client Authorization forwarded)  
- error normalization and logging discipline  
- future JWT-based S2S model  

---

## 2. Why the Gateway Exists

1. **Central public door**  
   All mobile/web/CLI clients hit the Gateway, never internal services.

2. **Security boundary**  
   Client-facing auth checks live here, workers stay private.

3. **Routing layer**  
   Gateway forwards requests to the correct service/version using SvcClient.

4. **Consistency surface**  
   Enforces standard requestId, logging, and Problem+JSON output.

5. **Future orchestration**  
   Will host rate-limits, usage metering, fan/venue tokens, AB tests, and fraud detection.

---

## 3. Gateway Boot Architecture

Gateway’s AppBase:

1. envBootstrap → fetch `svcEnv`  
2. mount health  
3. mount public routes  
4. mount service-proxy routes  
5. fail-fast if env invalid, indexes missing, or routes cannot be constructed  
6. log something like:  
   ```
   gateway ready at http://127.0.0.1:4015
   ```

### 3.1 Required Environment Vars

`NV_HTTP_HOST`, `NV_HTTP_PORT`  
From env-service only (zero .env drift).

### 3.2 Invariants

- Must not mount ANY route before health.  
- Must not start without valid svcEnv.  
- Must not declare static service locations; everything must pass through SvcClient.

---

## 4. Public Request Flow

### 4.1 Flow Diagram

```
Client → Gateway
  → extract or generate requestId
  → log inbound request
  → match route (create/update/read/list/delete)
  → strip DTO type + op into service call
  → SvcClient.call(slugKey, ...)
  → receive service response
  → normalize errors
  → return Problem+JSON or success envelope
```

### 4.2 Security Rules

- Gateway **must NOT** forward client Authorization header to any worker.
- All S2S calls must use Gateway’s own identity (slug=“gateway”, version=1).
- Future: Gateway will mint JWTs per S2S call with correct `aud`.

---

## 5. Route Stripping Semantics

Given inbound client URL:

```
PUT /api/<slug>/v<version>/<dtoType>/create
```

Gateway must:

1. Validate slug matches path segment  
2. Validate version matches  
3. Validate dtoType is well-formed (string, not empty)  
4. **Strip** `/api/<slug>/v<version>`  
5. Forward remainder to `<slug>@<version>` via SvcClient:

```
PUT /<dtoType>/create
```

### 5.1 Why stripping matters

- Ensures that service-facing URLs remain standard and predictable.  
- Avoids mismatched versions or cross-service confusion.  
- Keeps worker servers ignorant of `/api/...` prefixing.

---

## 6. Supported Operations

Gateway supports forwarding the full CRUD spectrum:

```
PUT    /api/<slug>/v<version>/<dtoType>/create
PATCH  /api/<slug>/v<version>/<dtoType>/update/:id
GET    /api/<slug>/v<version>/<dtoType>/read/:id
DELETE /api/<slug>/v<version>/<dtoType>/delete/:id
GET    /api/<slug>/v<version>/<dtoType>/list
```

### 6.1 Body Normalization

- Gateway MUST NOT mutate JSON body.  
- If no body provided for GET/DELETE, Gateway sends none.  
- If body invalid JSON → 400 at Gateway layer.

---

## 7. S2S Forwarding Contract

### 7.1 Required Headers Added

Gateway must add:

```
x-service-name: gateway
x-api-version: 1
x-request-id: <requestId>
```

### 7.2 Optional Headers Forbidden

- No client Authorization  
- No cookies  
- No raw client-supplied service headers

### 7.3 Body Contract

- JSON only  
- Must not include DTO classes  
- Must not include null prototype objects or functions  
- Must be plain JSON serializable

---

## 8. Error Normalization

Gateway receives either:

1. **Success** envelope  
2. **Problem+JSON error**  
3. **SvcClient error shape**

### 8.1 Normalization Rules

- If downstream returns Problem+JSON → forward exactly (preserve requestId).  
- If downstream returns non-JSON string → wrap as 502 Bad Gateway.  
- If SvcClient throws network error → 503 Service Unavailable.  
- If slugKey invalid → 500 Internal Error (developer fault).  
- If version mismatched → 400.

---

## 9. Logging Discipline

Each inbound request logs:

```
{
  event: "gateway_inbound",
  method, path, requestId
}
```

Each outbound call logs:

```
{
  event: "gateway_outbound",
  targetSlug, targetVersion,
  method, url,
  requestId
}
```

Errors log:

```
{
  event: "gateway_error",
  requestId,
  status,
  reason,
  details?
}
```

No logs may contain:
- client Authorization  
- body payloads  
- secrets  
- environment variables  
- raw DB errors  

---

## 10. Multi-Hop Chains

Gateway → Auth → User flow:

1. Client hits Gateway  
2. Gateway forwards to Auth  
3. Auth may call User  
4. requestId stable across all hops  
5. JWT (future) ensures domain-level S2S security

---

## 11. Future Gateway Evolution

- rate limiting  
- AB testing & traffic splitting  
- automatic version negotiation  
- caching of GET list queries  
- WebSocket upgrade support  
- circuit-breaking  
- JWT signing  
- CSP header injection for browser clients  
- cross-region routing  

---

End of LDD-14.
