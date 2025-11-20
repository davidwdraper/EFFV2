# LDD-03 — envBootstrap and SvcClient Rails (Deep, System-Level Detail)

## 1. Purpose
This chapter documents two of the most foundational rails in the NV backend:
- **envBootstrap** — how every CRUD service discovers its runtime configuration.
- **SvcClient + SvcEnvClient** — the core of NV’s internal service-to-service (S2S) communication.

These rails guarantee:
- deterministic environment loading,
- centralized non-secret configuration,
- stable boot behavior for all microservices,
- future compatibility with svcconfig and JWT-based S2S security.

---

## 2. Philosophy: Why Environment Must Come From env-service
Earlier NV generations mixed configuration sources:
- `.env` files,
- environment variables,
- ad hoc in-code defaults,
- static JSON configs.

This caused drift across microservices.

The v3 design mandates:
- **no .env parsing except NV_ENV**,  
- **all non-secret config comes from env-service**,  
- **each service gets a DtoBag<EnvServiceDto>**,  
- **bag hydration via DTO contract (no “doc” wrapper)**.

This guarantees:
- consistent config across clones,
- fully versioned environments,
- one observable source of truth,
- reproducible deployments.

---

## 3. envBootstrap — Conceptual Flow

### 3.1 Indented Diagram
envBootstrap:
  construct SvcClient(callerSlug, callerVersion) →
  construct SvcEnvClient(svcClient) →
  resolve NV_ENV (current environment) →
  GET config bag from env-service →
    DtoBag<EnvServiceDto> →
  derive NV_HTTP_HOST / NV_HTTP_PORT →
  return:
    envBag,
    envReloader(),
    host,
    port.

### 3.2 ASCII Diagram
envBootstrap
     ↓
SvcClient
     ↓
SvcEnvClient
     ↓
NV_ENV
     ↓
env-service/config
     ↓
DtoBag<EnvServiceDto>
     ↓
host/port extraction
     ↓
{ envBag, envReloader, host, port }

---

## 4. envBootstrap Responsibilities (Detailed)

### 4.1 SvcClient Construction
SvcClient is initialized with:
- callerSlug
- callerVersion

Purpose:
- this metadata is included in outbound headers,
- used for requestId generation,
- allows future S2S authorization (JWT issuer/audience).

### 4.2 SvcEnvClient Construction
SvcEnvClient:
- wraps SvcClient,
- handles env-service wire contract,
- converts JSON items into EnvServiceDto via fromJson(),
- produces DtoBag<EnvServiceDto>.

### 4.3 Resolve Current Environment
SvcEnvClient.getCurrentEnv():
- reads NV_ENV,
- trims whitespace,
- validates non-empty.

If missing:
- envBootstrap fails with BOOTSTRAP_CURRENT_ENV_FAILED.

### 4.4 Fetch Full Config Bag
GET /api/env-service/v1/env-service/config  
Query:
- env
- slug
- version

Response:
```
{
  items: [
    { id, env, slug, version, vars: {...}, ... }
  ],
  meta?: {}
}
```

Hydration:
- EnvServiceDto.fromJson(json, { validate: true })
- bag constructed via new DtoBag(items)

### 4.5 Host and Port Extraction
EnvServiceDto contains a vars record:
- NV_HTTP_HOST
- NV_HTTP_PORT

These define the actual listener.

Invariants:
- NV_HTTP_PORT must be a positive integer,
- NV_HTTP_HOST must be a string.

### 4.6 envReloader()
Returns:
- same lookup as boot,
- fetches fresh bag,
- ensures the service can re-hydrate environment on-demand.

Used in:
- AppBase logger reload,
- future dynamic config reloaders.

---

## 5. SvcClient — The One Door for All Internal Calls

### 5.1 Why a Single S2S Door Exists
The problem with earlier designs:
- multiple HTTP clients,
- no unified request IDs,
- inconsistent headers,
- inconsistent error handling.

SvcClient unifies:
- request construction,
- headers,
- logging,
- network error handling,
- content-type normalization,
- URL resolution (mock → svcconfig eventually),
- JSON parsing.

### 5.2 Required Headers (present & future)
SvcClient sets:
- x-service-name (callerSlug)
- x-api-version (callerVersion)
- x-request-id (generated)

Future:
- Authorization: Bearer <jwt> (internal S2S token)

### 5.3 SlugKey-Based Routing
Target services identified as:
```
<slug>@<version>
```

Examples:
- “env-service@1”
- “xxx@1”

SlugKey is parsed into:
- slug
- major version

### 5.4 Base URL Resolution (v1)
Current implementation:
- hardcoded mock map inside SvcClient.

This is sufficient for:
- local dev,
- smoke tests,
- cloning new services.

Eventually replaced by svcconfig.

### 5.5 Query Construction
buildUrl():
- enforces absolute path,
- adds all query params,
- constructs full URL via WHATWG URL.

### 5.6 Body Handling
If bodyJson is provided:
- JSON.stringify() applied,
- content-type=application/json added automatically.

### 5.7 JSON Parsing Discipline
parseJsonSafe():
- inspects content-type,
- tolerates non-JSON (returns raw payload),
- emits descriptive error on malformed JSON.

---

## 6. SvcEnvClient — The Typed Layer on Top of SvcClient

### Purpose
Env-service calls follow a strict DTO-first model. SvcEnvClient ensures that:
- all items returned are hydrated into EnvServiceDto,
- validation occurs at hydration,
- any schema mismatch becomes a client-side fatal error.

### 6.1 getCurrentEnv()
Simple NV_ENV extractor.

### 6.2 getConfig()
Calls:
```
GET /api/env-service/v1/env-service/config
```
and converts items[] to an array of EnvServiceDto.

Failure cases:
- HTTP non-2xx,
- response missing items[],
- any item fails hydration,
- empty bag.

---

## 7. Error Modes & Ops Guidance

### 7.1 Network Failures
SvcClient throws SVC_CLIENT_NETWORK_ERROR:
- service unreachable,
- DNS failure,
- ECONNREFUSED.

Ops: verify mock URL or svcconfig entry.

### 7.2 Invalid SlugKey
SvcClient throws SVC_CLIENT_INVALID_SLUGKEY.

Ops: fix typo, use “service@1” form.

### 7.3 Invalid Paths
SvcClient enforces absolute paths:
- path must start with “/”.

### 7.4 DTO Hydration Failures
SvcEnvClient throws SVCENV_CONFIG_DTO_HYDRATION_FAILED.

Ops:
- check env-service record,
- ensure EnvServiceDto contract matches stored JSON.

---

## 8. Transition to svcconfig (Future Roadmap)

### 8.1 Why svcconfig Exists
SvcClient’s mock map cannot scale beyond local dev. svcconfig will:
- store all service endpoints centrally,
- allow dynamic mapping of slugKey → URL,
- support versioned service discovery,
- unify routing for S2S calls.

### 8.2 Boot Changes in svcconfig Era
envBootstrap would:
- ask svcconfig for base URLs,
- use svcconfig instead of mock maps,
- allow dynamic port/host changes.

### 8.3 Impact on CRUD Rails
No API changes to CRUD services:
- SvcClient call signature unchanged,
- envBootstrap remains the same,
- registry/index behavior unaffected.

Only URL resolution changes.

---

## 9. Summary
envBootstrap + SvcClient + SvcEnvClient form the **spine** of NV’s environment-backed microservice design. Everything a CRUD service does depends on these rails being deterministic, validated, and fast-failing.

With these rails, the rest of the CRUD system behaves consistently across every service.

This concludes the envBootstrap & SvcClient deep dive.