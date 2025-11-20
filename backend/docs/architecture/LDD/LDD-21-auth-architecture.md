# LDD-21 — Auth Architecture  
*(Client Tokens, S2S JWTs, Roles, and Future User Accounts)*

---

## 1. Purpose

This chapter defines the *auth rails* for NowVibin, both present and future.  
It focuses on:

- How **clients** authenticate to the **Gateway**  
- How **services** authenticate to **each other** (S2S)  
- How **roles and permissions** are modeled over time  
- How auth integrates with WAL, logging, and rate limiting  
- What remains intentionally out of scope (secrets, passwords, KMS internals)

This is a design-first chapter: code will be built to match *these* rules, not the other way around.

---

## 2. Layers of Auth

Auth is split into three conceptual layers:

1. **Client → Gateway** (public edge)  
2. **Gateway → Internal Services** (S2S over JWT)  
3. **Service → Domain Objects** (role/permission checks inside CRUD flows)

They are *stacked*, not blended. A bug in one layer must not silently “compensate” in another.

---

## 3. Client → Gateway Auth

### 3.1 Goals

- Simple for mobile/web clients  
- Strong enough for paid products  
- Forward-compatible with real identity providers (OIDC, social login, etc.)  
- Easy to revoke and rotate

### 3.2 Token Model (Phase 1 – MVP)

For the first operational phase:

- Gateway supports **opaque bearer tokens** representing:
  - fan
  - act
  - venue
  - internal tooling  
- Tokens are validated *locally* at the Gateway:
  - via signing secret (HMAC) **or**
  - via lookup in a small auth DB (for early MVP)

A valid token yields a **principal** structure:

```ts
type Principal = {
  subjectId: string;       // user/act/venue id
  subjectType: "fan" | "act" | "venue" | "admin" | "tool";
  roles: string[];         // e.g., ["fan.basic"], ["venue.owner"]
  scopes: string[];        // optional, per-feature
};
```

### 3.3 Invariants

- All client-auth decisions happen **only at the Gateway**.  
- Internal services must *never* interpret raw client tokens.  
- If token is missing or invalid:
  - Gateway returns 401/403 with Problem+JSON.
  - Request never reaches internal CRUD services.

---

## 4. Gateway Auth Flow

### 4.1 Request Pipeline (High-Level)

1. Extract `Authorization` header (if any).  
2. Parse token; validate integrity and expiry.  
3. Resolve principal (subject, roles, scopes).  
4. Attach principal to request context.  
5. Apply **route-level policy**:
   - e.g. `/venue/*` → requires `subjectType="venue"`  
   - e.g. `/act/*` → requires `subjectType="act" | "admin"`  
6. On success: forward request internally via S2S (with JWT, future).  
7. On failure: 401/403 Problem+JSON.

### 4.2 Problem+JSON for Auth Errors

Examples:

```json
{
  "type": "about:blank",
  "title": "Unauthorized",
  "detail": "Missing or invalid access token.",
  "status": 401,
  "code": "UNAUTHORIZED",
  "requestId": "..."
}
```

```json
{
  "type": "about:blank",
  "title": "Forbidden",
  "detail": "You do not have permission to access this resource.",
  "status": 403,
  "code": "FORBIDDEN",
  "requestId": "..."
}
```

No token trivia; no debug hints to attackers.

---

## 5. Gateway → Service Auth (S2S JWT)

### 5.1 Why S2S JWT?

- Prove that internal calls are from **real NV services**, not random scripts.  
- Carry **service identity** and **requestId** across hops.  
- Enable per-caller authorization in services (e.g., Gateway vs batch jobs).

### 5.2 JWT Claims (Draft)

```json
{
  "iss": "gateway",            // caller slug
  "sub": "gateway",            // same as iss for S2S
  "aud": "xxx",                // target service slug
  "nv_ver": 1,                 // caller version
  "nv_env": "dev",             // environment
  "nv_rid": "<requestId>",     // requestId
  "iat": 1710000000,
  "exp": 1710000030           // short TTL
}
```

### 5.3 Invariants

- **Short-lived** tokens (≤ 60 seconds).  
- Signed by KMS-managed keys (future).  
- Verified by every internal service before any handler runs.  
- If JWT fails validation:
  - service returns 401/403 Problem+JSON  
  - logs a **security** event  
  - does not touch persistence

---

## 6. Service-Level Auth (Inside CRUD)

Even after S2S auth passes, services may enforce **domain-level auth**:

- e.g., “Only owner of this venue can update its config.”  
- e.g., “Only act owners can manage their availability.”

### 6.1 Principal Representation Internally

Gateway may propagate a distilled principal in S2S payloads (or headers) for domain checks, e.g.:

```json
{
  "nvPrincipal": {
    "subjectId": "act_123",
    "subjectType": "act",
    "roles": ["act.basic"]
  }
}
```

Domain services then:

- trust the S2S JWT identity (caller=Gateway)  
- use `nvPrincipal` as a read-only description of the end user  
- apply DTO- and route-level rules accordingly

### 6.2 Invariants

- Internal services do **not** validate client tokens.  
- They **assume** Gateway has already authenticated and authorized.  
- They may **refuse** a request if `nvPrincipal` is missing for routes that require it.

---

## 7. Roles & Permissions (High-Level Model)

Roles are hierarchical and additive:

- `fan.basic` → browse, credit, follow acts  
- `act.basic` → manage act profile, claim events  
- `venue.owner` → manage venue profile, credibility, staff  
- `admin.ops` → ops-only features  
- `tool.scraper` → automated ingestion tasks

Permissions are checked at two main points:

1. Gateway route policy (coarse-grained).  
2. Service-level handler checks (fine-grained, e.g. “owner of this record?”).

---

## 8. Logging, WAL, and Auth

### 8.1 Logging

All auth decisions must log:

- decision outcome (allow/deny)  
- reason code (e.g. TOKEN_EXPIRED, MISSING_ROLE)  
- subjectId / subjectType (if available)  
- requestId  

Security logs are *separate* from app logs.

### 8.2 WAL Integration (Future)

WAL entries may include:

```json
{
  "actorUserId": "<subjectId>",
  "actorType": "fan" | "act" | "venue" | "admin"
}
```

This ties every mutation to an authenticated identity, not just a requestId.

---

## 9. Failure Modes

### 9.1 Bad Tokens (Client Edge)

- Expired, malformed, forged  
- Result: 401 / 403 at Gateway  
- No internal traffic generated  

### 9.2 Broken S2S JWT (Internal)

- Signature invalid  
- Wrong audience  
- Expired  
- Clock skew too large  

Result:
- 401 / 403 from internal service  
- Security log  
- Possible circuit-breaker / rate-limit if repeated

### 9.3 Missing Principal for Protected Route

- Gateway forgot to attach principal  
- Service refuses the request with FORBIDDEN / INTERNAL_ERROR depending on context  
- Logged as **system bug**, not user error

---

## 10. Out of Scope (For This LDD)

- Exact token storage and lifecycle for users (fans/acts/venues)  
- Password handling and credential storage  
- Full OAuth2/OIDC flow design  
- 3rd-party identity providers

Those will live in a dedicated **Auth LDG** once the auth service is implemented.

---

## 11. Roadmap

1. **Phase 1 (MVP)**  
   - Opaque bearer tokens at Gateway  
   - Simple principal model  
   - No S2S JWT yet (trust internal localhost-only topology)

2. **Phase 2**  
   - Introduce S2S JWTs  
   - verifyS2S middleware in every service  
   - separate security logs  
   - principal attached via headers/body from Gateway

3. **Phase 3**  
   - Full auth service (LDG-auth)  
   - User accounts, refresh tokens  
   - Device binding (for venues/acts)  
   - Role management UI & audit

4. **Phase 4**  
   - Multi-region-aware auth  
   - Federation with external identity providers  
   - Fine-grained scopes per feature

---

End of LDD-21.
