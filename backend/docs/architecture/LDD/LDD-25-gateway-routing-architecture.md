# LDD‑25 — Gateway & Routing Architecture

## 1. Purpose

The Gateway is the single public entrypoint into NV’s service mesh.  
All external client traffic (mobile app, venue portal, ops tooling) comes through Gateway and is either:

- served directly (static web, health),
- authenticated, or
- proxied to internal services via S2S calls (using SvcClient).

This document describes the routing architecture, service resolution, S2S rules, and security rails that govern the Gateway.

---

## 2. Core Responsibilities

### 2.1 Single Public Surface
Gateway exposes only:

- `/api/<slug>/health` — public health per service
- `/api/<slug>/v<version>/<dtoType>/<op>` — versioned CRUD routes (proxy mode)
- Static assets (optional)
- Auth entrypoints (login/token in v2)

Everything else stays behind the curtain.

### 2.2 SvcEnv + svcconfig Resolution
Gateway must load:
- Its own EnvServiceDto via envBootstrap.
- Target service URLs via **svcconfig** (v2), replacing the mock base URLs currently hardcoded inside SvcClient.

### 2.3 Edge Auth
Gateway enforces:
- Client authentication (JWT or API keys)
- Rate limiting (future)
- CORS (strict allowlist)
- Request validation (headers + body parsing rules)
- RequestId propagation

### 2.4 RequestId Discipline
Every inbound request gets:
- bound `x-request-id` (client-provided or generated)
- forwarded as-is on all S2S calls
- logged on entry, proxy, and exit

---

## 3. Boot Architecture

1. envBootstrap loads EnvServiceDto (host/port).
2. createGatewayApp():
   - mount logger, cors, parsers
   - mount health route first
   - initialize SvcClient (mock or real svcconfig-backed)
   - mount **proxy routers**
3. Gateway listens.

Gateway never starts if:
- Env bag missing
- Missing NV_HTTP_HOST/PORT
- svcconfig resolution fails
- Health route can't bind

Fail-fast or don’t start — SOP.

---

## 4. Routing Model

### 4.1 Health
`/api/gateway/health` returns:
```json
{ "ok": true }
```
No auth. No dependencies.

### 4.2 CRUD‑style Proxy Routes
Pattern:
```
PUT    /api/<slug>/v<version>/<dtoType>/create
PATCH  /api/<slug>/v<version>/<dtoType>/update/:id
GET    /api/<slug>/v<version>/<dtoType>/read/:id
DELETE /api/<slug>/v<version>/<dtoType>/delete/:id
GET    /api/<slug>/v<version>/<dtoType>/list
```

Gateway does **zero** business logic.  
Its job is:

1. Parse inbound.
2. Validate `<slug>`, `<version>`, `<dtoType>`.
3. Forward to the matching service using `SvcClient.call(slug@version, ...)`.
4. Mirror raw wire JSON back to client.

### 4.3 Proxy Behavior Matrix

| Case | Behavior |
|------|----------|
| Target service returns 2xx | Pass through unchanged |
| 4xx | Pass through unchanged (client error) |
| 5xx | Pass through unchanged (service error) |
| Network error | Gateway formats as problem+json with code `UPSTREAM_UNREACHABLE` |

No massaging, no transformations — transparency is a feature.

---

## 5. Service Resolution (SlugKey)

### 5.1 SlugKey Format
```
<slug>@<version>
```
Examples:
- `xxx@1`
- `env-service@1`
- `auth@1`

### 5.2 svcconfig Integration (v2)
SvcClient must query svcconfig to obtain:
- host
- port
- protocol
- security requirements

Until then, Gateway uses hard‑coded MOCK URLs in SvcClient.  
Transition plan:

1. Add svcconfig-client in shared.
2. Gateway loads entire svcconfig bag at boot.
3. SvcClient swaps `resolveBaseUrl()` to use svcconfig values.
4. MOCK map is deleted.

---

## 6. Security Rails

### 6.1 Required Inbound Headers
- `x-request-id` (optional but preferred)
- `authorization` (for client auth)
- `content-type: application/json` for JSON ops

### 6.2 Outbound S2S Headers (Gateway → Service)
- `x-service-name: gateway`
- `x-api-version: 1`
- `x-request-id: <same>`
- `authorization: <S2S JWT>` (future KMS)

### 6.3 Guard Rails
- Gateway never forwards client Auth headers to internal services.
- Gateway never touches DTOs.
- Gateway enforces CORS early and consistently.
- Gateway logs all 4xx/5xx returns including upstream errors.

---

## 7. Proxy Flow (Expanded Diagram)

```
Client
  → Gateway (Express)
      → parse dtoType/slug/version
      → validate route shape
      → build SvcClient request
      → call slug@version
           → service receives original x-request-id
           → performs CRUD
      ← service returns response
  ← Gateway mirrors response
```

Failure flow:
```
SvcClient error
  → wrap into problem+json
  → status=502
  → code="UPSTREAM_UNREACHABLE"
  → include requestId
```

---

## 8. Anti‑Patterns

- ❌ Doing business logic in Gateway  
- ❌ Massaging wire JSON  
- ❌ Transforming response bodies  
- ❌ Allowing dynamic path rewrites (dangerous)  
- ❌ Creating duplicate registry logic  
- ❌ Handling ID generation (belongs to services)  

---

## 9. Testing Guidance

### 9.1 Unit
- validate route binding
- validate slug/version parsing
- mock SvcClient, assert correct calls

### 9.2 Integration
- run real target service(s) locally
- verify pass‑through semantics
- verify x-request-id propagation

### 9.3 Smoke Tests (NV end‑to‑end)
- test001-gateway-health
- CRUD tests with Gateway in front of xxx-service
- upstream failure test

---

## 10. Roadmap

### v2 — svcconfig Integration
- real topology from DB-backed svcconfig
- dynamic service registration

### v3 — Edge Auth
- full JWT validation
- rate limiting
- geo-aware routing

### v4 — Zero‑Downtime Deploys
- weighted proxying
- health‑aware failover

