# LDD‑26 — SvcConfig Architecture (Dynamic Service Topology)

## 1. Purpose

SvcConfig is NV’s dynamic, DB-backed service topology authority.

It replaces:
- hardcoded MOCK_BASE_URLS in SvcClient,
- ad‑hoc environment variables defining service hosts/ports,
- manual rewiring when adding or moving services.

Every service, including gateway and env-service, will query svcconfig to discover where other services live and how to contact them.

---

## 2. Core Responsibilities

### 2.1 Topology Source of Truth
SvcConfig stores one record per:
```
(env, slug, version)
```

Each record expresses:
- **host** (IP or DNS)
- **port**
- **protocol** (`http` / `https`)
- **public?** (bool — whether gateway should expose it)
- **healthPath**
- **bootstrapPriority** (future: rolling deploys)
- **metadata** (arbitrary expansion)

### 2.2 Service Registration (Future v2+)
When services start:
1. they register with svcconfig,
2. provide their health URL,
3. validate that no duplicate slug@version exists for the same env,
4. begin serving only after svcconfig acknowledges.

This enables:
- rolling restarts,
- crash detection,
- eventual autoscaling.

---

## 3. Data Model

### 3.1 DTO Shape
Modeled as a standard NV DTO (`SvcConfigDto`):

```
id: string                ← canonical id ("env@slug@version")
env: string               ← e.g., "dev"
slug: string              ← service slug
version: number           ← major API version
host: string
port: number
protocol: "http" | "https"
healthPath: string
public: boolean
metadata: Record<string, string>
createdAt: string
updatedAt: string
updatedByUserId: string
```

All fields validated by zod at DTO level.

### 3.2 Index Hints
- UX index on `(env, slug, version)` unique.
- Index on `(public)` for gateway scanning.
- Index on `(slug)` for CLI tooling.

---

## 4. Wire Contract

### 4.1 Read
```
GET /api/svcconfig/v1/svcconfig/read/:id
→ { items: [ SvcConfigDtoJson ] }
```

### 4.2 Lookup by Keys
```
GET /api/svcconfig/v1/svcconfig/lookup?env=&slug=&version=
→ { items: [ SvcConfigDtoJson ] }
```

### 4.3 List (for gateway boot)
```
GET /api/svcconfig/v1/svcconfig/list?env=<env>
→ bag of all service configs for this environment
```

Gateway uses this list to populate a routing table.

---

## 5. Gateway Integration

### 5.1 Boot Sequence
1. Gateway loads its EnvServiceDto (host/port).
2. Gateway uses SvcClient to call `svcconfig@1`.
3. Gateway requests:
   ```
   /svcconfig/list?env=<env>
   ```
4. Builds in-memory routing map:

```
slug@version → {
    host,
    port,
    protocol,
    healthPath,
    public,
    metadata
}
```

### 5.2 Runtime Resolution
SvcClient’s `resolveBaseUrl()` becomes:

```
lookup slug@version in routingTable
if missing → fail-fast with SVC_CLIENT_UNKNOWN_TARGET
```

Mocks disappear. Dynamic topology begins.

---

## 6. Service Integration

### 6.1 Calling Other Services
Any service can call any other internal service by slugKey:

```
const res = svcClient.call("auth@1", { ... });
```

SvcClient resolves via svcconfig routing table.

### 6.2 Detecting Drift
If a service tries to call a slug@version not in svcconfig:
- it is a deployment/configuration error,
- services must not invent topology,
- fail-fast with operator guidance:
  ```
  SVC_CLIENT_UNKNOWN_TARGET: "auth@2" unavailable — confirm svcconfig record exists
  ```

---

## 7. CRUD, Versioning & Topology Rules

### 7.1 Versioning Strategy
Major version increments require:
- new svcconfig record,
- new DTO version for target service,
- gateway allows both v1 and v2 during rollout,
- old version may be disabled via svcconfig without touching gateway code.

### 7.2 Deleting a Service Version
- Remove from svcconfig.
- Services fail-fast when hitting missing slug@version.
- Gateway rejects routes referencing that version.

### 7.3 Adding a Service
Add a record:
```
env: "dev"
slug: "payments"
version: 1
host: "127.0.0.1"
port: 4030
protocol: "http"
```

SvcClient starts routing to it instantly.

---

## 8. Health & Observability

### 8.1 Health Fan‑Out
Gateway’s aggregated health route (future):

```
/api/gateway/health/mesh
```

Calls:
- each public service’s `healthPath`
- reports composite status

### 8.2 Degraded Mode (future v3)
If a service reports unhealthy:
- gateway marks service as degraded,
- optional: serve cached responses,
- optional: temporarily reroute to backup.

---

## 9. Failure Modes

### 9.1 svcconfig Unavailable at Boot
Gateway must:
- fail-fast,
- log operator guidance,
- never start.

### 9.2 svcconfig Unavailable at Runtime
SvcClient:
- returns 503 upstream error,
- problem+json:
  ```
  code: "SVCCONFIG_UNREACHABLE"
  ```

### 9.3 Drift Between EnvService and SvcConfig
If EnvServiceDto for gateway references host/port that disagree with svcconfig:
- EnvService governs *gateway’s* own boot,
- SvcConfig governs *all other service URLs*,
- Operators must align both systems.

---

## 10. Anti‑Patterns

- ❌ Hardcoding base URLs  
- ❌ Allowing dynamic user-driven rewrites  
- ❌ Gateway registering services on behalf of others  
- ❌ Services calling unknown or non‑versioned slugs  
- ❌ Optional topology (every service version must be registered explicitly)

---

## 11. Testing Strategy

### 11.1 Unit
- Validate topology parsing
- Validate routing table creation
- Validate slug@version lookup

### 11.2 Integration
- Run real svcconfig service
- Update records mid-run (future hot reload)
- Ensure SvcClient immediately routes to new target

### 11.3 Smoke
- gateway-health
- gateway-proxy CRUD
- svcconfig lookup failure tests
- svcconfig dynamic add/remove tests (future)

---

## 12. Roadmap

### v2
- SvcConfig service implemented
- Gateway fully de-mocks SvcClient
- Services registered via DTO CRUD

### v3
- Hot Reload: gateway watches svcconfig changes
- weighted routing
- zero-downtime rollouts

### v4
- auto discovery  
- mesh awareness  
- failover groups  
