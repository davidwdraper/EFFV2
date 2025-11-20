# LDD-16 — svcconfig Architecture  
*(Routing Metadata, Hot Reload, Target Discovery, Service Registry)*

## 1. Purpose

svcconfig is the authoritative registry for **network routing metadata** across all NV backend services.  
Where env-service stores **non-secret configuration**, svcconfig stores **where services live**.

This chapter formalizes:

- svcconfig’s data model  
- svcconfigDto contract  
- Routing metadata (`host`, `port`, `protocol`)  
- slugKey resolution rules  
- svcconfig → SvcClient integration  
- Hot reload (svcReloader)  
- Indexing and lifecycle semantics  
- Future evolution (multi-region, blue/green, version negotiation)  

---

## 2. Why svcconfig Exists

1. **Dynamic routing**  
   Remove hardcoded URLs. All service locations live in DB.

2. **Hot updates**  
   When a service moves/changes versions, no restarts required.

3. **Single source of truth**  
   All routing logic derives from svcconfig.

4. **Gateway orchestration**  
   Gateway uses svcconfig to forward traffic!

5. **Service discovery, phase 2**  
   Enables future “who provides what” discovery.

---

## 3. svcconfig Record Shape

Each record represents one deployed service version:

```
{
  id: "dev@auth@1",
  env: "dev",
  slug: "auth",
  version: 1,
  url: "http://127.0.0.1:4020",
  host: "127.0.0.1",
  port: 4020,
  protocol: "http",
  createdAt: "...",
  updatedAt: "...",
  updatedByUserId: "system"
}
```

### 3.1 Key Rules

- `_id = "${env}@${slug}@${version}"`  
- `host`: IPv4, IPv6, or hostname  
- `port`: numeric, >0  
- `protocol`: "http" | "https"  
- `url`: canonical combination of protocol + host + port  

---

## 4. Collection & Indexing

Collection: `"svcconfig"`

Indexes:
```
_id: unique
{ env:1, slug:1, version:1 }: unique
{ slug:1, version:1 }
```

All lookups done via `_id` for speed & determinism.

---

## 5. svcconfig Endpoints (CRUD)

### 5.1 GET /resolve/:slugKey

```
GET /api/svcconfig/v1/resolve/<slug>@<version>
→ { url:"http://127.0.0.1:4020" }
```

Errors:
- UNKNOWN_SLUGKEY  
- NOT_FOUND  
- MISMATCH_VERSION  
- INVALID_SLUGKEY  

### 5.2 UPDATE /:id

Used by deployment tools to update routing metadata.

### 5.3 LIST /registry

For operators to inspect all svcconfig records.

---

## 6. SvcClient Integration

SvcClient.resolveBaseUrl() becomes:

```
GET /api/svcconfig/v1/resolve/<slug>@<version>
→ returns URL
```

### 6.1 Invariants

- No mock tables once svcconfig is live  
- SvcClient must never fallback to defaults  
- All routing derived from DB-sourced config  
- requestId must be forwarded to svcconfig  

### 6.2 Performance

- Resolve results cached for TTL=5s (future)  
- Cache invalidation triggered by svcReloader  

---

## 7. svcconfig Bootstrap in Services

Each service will have:

```
envBootstrap → svcconfigClient.bootstrap() → (optional future)
```

Today, services only query svcconfig through SvcClient, but in the future:

- svcconfigClient will be introduced  
- registry bag returned to AppBase  
- services can watch for routing changes  

---

## 8. Hot Reload (svcReloader)

Services may call:

```
await svcReloader()
```

Which:
1. Calls GET /resolve/<slugKey> for all dependencies  
2. Updates local routing cache  
3. Logs reload event  
4. Never suppresses errors  

### 8.1 Error Modes

- svcconfig not reachable → fatal  
- empty result → fatal  
- invalid JSON → fatal  

---

## 9. Routing Semantics

### 9.1 URL Formation

SvcClient uses:

```
<protocol>://<host>:<port>
```

### 9.2 Path Concatenation

SvcClient must append API paths without modifying them.

### 9.3 Versioning

SlugKey must match exact version.  
No auto-upgrade/downgrade allowed.

---

## 10. Logging Rules

svcconfig must log:

```
{ event:"svcconfig_resolve", slug, version, requestId, url }
```

Services using svcconfig must log every fetch and reload.

---

## 11. Future Evolution

### 11.1 Multi-Region Routing

svcconfig may store region/zone info:

```
region: "us-west-2"
zone: "us-west-2a"
```

SvcClient chooses nearest region based on node placement.

### 11.2 Blue/Green + Canary Deployments

svcconfig may hold:

```
weights: { v1: 0.9, v2: 0.1 }
```

Gateway performs weighted routing for progressive rollout.

### 11.3 Health-Aware Routing

svcconfig may track service health and expose:

```
status: "healthy" | "degraded" | "down"
```

SvcClient avoids unhealthy targets.

---

End of LDD-16.
