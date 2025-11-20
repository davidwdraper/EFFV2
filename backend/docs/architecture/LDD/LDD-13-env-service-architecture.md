# LDD-13 — Env‑Service Architecture  
*(Config Model, Bag Retrieval, Key/Value Contract, Reloader Semantics)*

## 1. Purpose

env‑service is the authoritative, database‑backed provider of **non‑secret runtime configuration** for every NV backend service.  
This chapter formalizes:

- The EnvServiceDto key/value contract  
- Bag‑based config retrieval  
- The `_id = env@slug@version` model  
- envBootstrap and envReloader semantics  
- Indexing rules  
- Update flows  
- Service lifecycle guarantees  
- Future evolution toward hierarchical config + svcconfig integration  

---

## 2. Why env‑service Exists

1. **Zero .env drift**  
   All non‑secret config originates from a **single DB record** per (env, slug, version).

2. **Hot reload**  
   Services can call `envReloader()` to refresh config without restart.

3. **Deterministic service identity**  
   `_id = "env@slug@version"` ensures stable, predictable lookup.

4. **No environment branching hell**  
   All environments (dev/stage/prod) use the *exact same* config schema.

5. **Dynamic system‑wide rollout**  
   When config updates, all services gradually adopt changes via reloaders.

---

## 3. EnvServiceDto — The Contract

Each config document must satisfy:

```
{
  id: "dev@xxx@1",
  env: "dev",
  slug: "xxx",
  version: 1,
  vars: {
     NV_HTTP_HOST: "127.0.0.1",
     NV_HTTP_PORT: "4016",
     ...
  },
  createdAt: "...",
  updatedAt: "...",
  updatedByUserId: "system",
}
```

### 3.1 Key Rules

- `env`: string, logical environment name
- `slug`: service slug
- `version`: major version of service API
- `_id` **must** equal `"${env}@${slug}@${version}"`

### 3.2 vars Map

`vars: Record<string,string>` must contain:

- `NV_HTTP_HOST`
- `NV_HTTP_PORT`
- Any service‑specific values
- Any required persistence keys (`NV_MONGO_URI`, `NV_MONGO_DB`, etc.)

### 3.3 DTO Invariants

- DTO **owns** validation via Zod contract  
- DTO **must** be hydrated only through dto.fromJson()  
- **No mutation** outside patchFrom()  
- DTO must specify its collection using `dbCollectionName()`  

---

## 4. DB Storage Model

Collection name: `"env-service"`  

Each environment record is keyed by `_id = env@slug@version`.

### 4.1 Index Hints

EnvServiceDto declares:

```
indexHints = [
  { keys: { _id: 1 }, options: { unique: true } },
  { keys: { env: 1, slug: 1, version: 1 }, options: { unique: true } }
]
```

### 4.2 Why this matters

- Fast lookup by the three‑part key  
- Single source of truth  
- Guaranteed no duplicates  

---

## 5. env-service Endpoints

### 5.1 GET /config

```
GET /api/env-service/v1/env-service/config
  ?env=<env>
  &slug=<slug>
  &version=<v>
```

Returns:

```
{
  items: [ <EnvServiceDto.toJson()> ],
  meta: { ... }?
}
```

This must always return a **non‑empty** items array.

### 5.2 UPDATE Pipeline (Template)

1. Load existing config bag  
2. Apply patch  
3. Persist updated DTO via DbWriter  
4. Return singleton bag  

### 5.3 CREATE Pipeline

Used only internally for initial provisioning.

---

## 6. envBootstrap — The Consumer Side

envBootstrap is used by *all services except env‑service itself*.

### 6.1 Steps

1. Construct SvcClient  
2. Construct SvcEnvClient  
3. Read NV_ENV (logical environment)  
4. GET /config from env-service  
5. Hydrate DtoBag<EnvServiceDto>  
6. Extract primary DTO → `svcEnv`  
7. Extract NV_HTTP_HOST and NV_HTTP_PORT  
8. Build bag‑based reload function  
9. Return `{ envBag, envReloader, host, port }`

---

## 7. envReloader — Hot Config Reload

Reloader contract:

```
async function envReloader(): Promise<DtoBag<EnvServiceDto>>
```

### 7.1 Invariants

- Must always return a **fresh bag**  
- Must perform the identical lookup as bootstrap  
- Must never return an empty bag  
- Must never suppress errors  
- Services may call it during runtime to update `svcEnv`

---

## 8. Error Modes

- Missing NV_ENV → fatal  
- Config bag empty → fatal  
- Config bag missing NV_HTTP_HOST/PORT → fatal  
- JSON hydration error → fatal  
- Duplicate or ambiguous configs → fatal  

envBootstrap must abort (`process.exit(1)`) with concrete operator guidance.

---

## 9. Logging Requirements

env-service must log:

- all reads  
- all updates  
- dtoType and collection  
- requestId  
- error surfaces  
- validation errors (with issues[])  

envBootstrap logs:

- start, completion  
- derived host/port  
- failures with actionable messages  

---

## 10. Future Evolution

### 10.1 Hierarchical Config

env-service may expand to layered configuration:

- global default  
- per‑env override  
- per‑service override  
- per‑version override  

Merge strategy must remain deterministic and shallow.

### 10.2 svcconfig Integration

env-service and svcconfig will unify in Phase 3:

- env-service provides non‑secret config  
- svcconfig provides network routing + service metadata  
- both queried by envBootstrap and SvcClient  

### 10.3 Secrets Layer (out of scope)

Secret management will migrate to a dedicated KMS-backed service.

---

End of LDD-13.
