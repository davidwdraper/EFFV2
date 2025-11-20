# LDD-28 — Auth Service Architecture  
*(Tokens, Identity, Roles, and Integration with Gateway & Services)*

---

## 1. Purpose

This chapter defines the **Auth Service** for NV:

- the core responsibilities and non-responsibilities of `auth@1`
- token types and lifecycles (access, refresh, service)
- identity models for fans, acts, venues, and admins
- integration with Gateway (client edge) and internal services (S2S)
- how Auth interacts with WAL, Audit, and env-service
- the roadmap from simple MVP auth to full production auth

LDD-21 described *Auth Architecture at the platform level*.  
LDD-28 focuses specifically on the **Auth Service** as a CRUD-style component in the mesh.

---

## 2. Scope & Non-Scope

### 2.1 In-Scope for `auth@1`

- Credential verification for supported login methods (MVP: email+code; later: password, OAuth).
- Minting and validating **access tokens** and **refresh tokens**.
- Storing and managing **identity records** (fan, act, venue, admin).
- Role and scope assignment for identities.
- Session / device bindings (MVP: single-device metadata only).
- Providing a clean API to:
  - log in,
  - refresh tokens,
  - introspect tokens (Gateway-only),
  - revoke tokens.

### 2.2 Out-of-Scope

- UI / front-end flows.
- Managing payments, subscriptions, or entitlements (belongs to billing/credits).
- Fine-grained per-entity ACLs (handled in domain services).
- S2S JWT mint/verify keys (KMS integration is a separate rail; Auth integrates with it later).

---

## 3. High-Level Architecture

Auth Service is a standard NV CRUD service with:

- Env-driven boot via `envBootstrap`.
- DTOs and contracts for:
  - `AuthIdentityDto` (user/subject record).
  - `AuthSessionDto` (session / device).
  - `AuthTokenDto` (token metadata, if persisted).
- Registry and pipelines just like `t_entity_crud`.

The key difference is **what the service does**:

- it issues cryptographically signed tokens,
- it tracks identity and session state,
- it serves as the central authority for the Gateway’s client-edge auth flow.

---

## 4. Identity Model

### 4.1 Identity Types

`AuthIdentityDto` represents a logical subject:

```ts
type SubjectType = "fan" | "act" | "venue" | "admin";

AuthIdentity = {
  id: string;               // UUID
  subjectType: SubjectType;
  primaryEmail: string | null;
  phone: string | null;
  externalId: string | null;  // e.g., OAuth provider ID
  roles: string[];            // e.g. ["fan.basic"], ["venue.owner"]
  createdAt: string;
  updatedAt: string;
  updatedByUserId: string;
};
```

### 4.2 Role Semantics

- **fan.basic** — can browse, credit, follow.
- **act.basic** — can manage act profile.
- **venue.owner** — can manage venue location, events.
- **admin.ops** — internal tooling and ops.

Auth does not enforce business logic; it simply stores and returns roles for Gateway and services to enforce.

---

## 5. Token Model

### 5.1 Access Tokens

Short-lived tokens with:

- subjectId
- subjectType
- roles
- scopes
- issuedAt, exp
- a unique tokenId (for revocation support)

Format: JWT (HMAC or asymmetric signature once KMS lands).

### 5.2 Refresh Tokens

Long-lived, random opaque strings, mapped server-side:

```ts
RefreshToken = {
  id: string;          // tokenId
  subjectId: string;
  subjectType: SubjectType;
  deviceId: string | null;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};
```

Refresh tokens are never sent to other services; only the Auth service and client see them.

### 5.3 S2S Tokens (Future)

Auth may eventually become the minting authority for **S2S JWTs** (Gateway → service, service → service).  
In v1, S2S JWT minting may be handled by a simple shared rail with a static key; Auth plugs into that later via KMS.

---

## 6. Auth Service APIs (MVP)

All routes follow the standard LDD rails (`/api/auth/v1/...`), using `dtoType` where applicable.

### 6.1 Login (Email + Code, MVP)

**Initiate login**:

- `POST /api/auth/v1/email/login/initiate`
- body: `{ email: string }`
- behavior:
  - generate a one-time code
  - store hashed code + expiry against identity/email
  - send code via email (stub for MVP)
  - respond `{ ok: true }` or 429 if too many attempts

**Complete login**:

- `POST /api/auth/v1/email/login/complete`
- body: `{ email: string; code: string; deviceId?: string }`
- behavior:
  - verify code
  - find or create `AuthIdentityDto` for that email (subjectType=fan by default)
  - issue access + refresh tokens
  - return:
    ```json
    {
      "accessToken": "...",
      "refreshToken": "...",
      "principal": {
        "subjectId": "...",
        "subjectType": "fan",
        "roles": ["fan.basic"]
      }
    }
    ```

### 6.2 Refresh

- `POST /api/auth/v1/token/refresh`
- body: `{ refreshToken: string; deviceId?: string }`
- behavior:
  - validate refresh token, expiry, revocation status
  - issue new access token
  - optionally rotate refresh token
  - respond with new access token (and new refresh if rotation is implemented)

### 6.3 Introspect (Gateway-only)

- `POST /api/auth/v1/token/introspect`
- body: `{ token: string }`
- behavior:
  - validate JWT
  - return principal structure:
    ```json
    {
      "active": true,
      "principal": {
        "subjectId": "...",
        "subjectType": "...",
        "roles": ["..."]
      },
      "exp": 1710000000
    }
    ```

In practice, Gateway will prefer local verification using shared keys; introspection is a secondary rail.

### 6.4 Revoke

- `POST /api/auth/v1/token/revoke`
- body: `{ refreshToken: string }`
- behavior:
  - mark refresh token as revoked
  - optional: store revocation for certain access tokens (by tokenId) for high-sensitivity flows

---

## 7. Pipelines & DTOs in Auth

Auth uses the same pipeline pattern as `t_entity_crud`, but with specialized dtoTypes:

- `auth-identity`
- `auth-session`
- `auth-refresh-token`
- `auth-email-code` (for login codes)

### 7.1 Example Pipeline: Login Complete

1. `BagPopulatePostHandler`
2. `EmailCodeValidateHandler`
3. `LoadOrCreateIdentityHandler`
4. `IssueTokensHandler`
   - build JWT payload
   - sign token
   - persist refresh token DTO
5. `PrepareAuditAuthHandler`
6. `BagToDbAuthHandler` (for any DTOs created/updated)
7. `BuildPrincipalResponseHandler`

The controller remains orchestration-only.

---

## 8. Security Considerations

### 8.1 Token Storage

- Access tokens: stored on client only; Auth does not persist them (except maybe `jti` / tokenId for revocation lists).
- Refresh tokens: persisted via DTO, **hashed** where appropriate to avoid leakage (similar to password hashes).

### 8.2 Brute Force & Abuse

Auth must implement:

- rate limiting by `email` and `ip` on login-initiate and login-complete.
- lockout after repeated failed codes per email/device combination.
- configurable policies via env-service.

### 8.3 Transport

- All auth endpoints must require HTTPS in non-local environments.
- Tokens must never be logged in full; only short prefixes for debugging.

---

## 9. WAL & Audit Integration

### 9.1 WAL

WAL is applied to any persisted DTOs:

- new identities
- new sessions
- new refresh tokens
- revocations and lockouts

### 9.2 Audit

At minimum, audit logs:

- successful logins (subjectId, subjectType, deviceId)
- failed logins (with limited detail; avoid leaking user existence)
- token revocations
- role changes

Audit never stores full tokens or secrets.

---

## 10. Env & Config

Auth gets its config from env-service:

- NV_HTTP_HOST / NV_HTTP_PORT
- NV_MONGO_URI / NV_MONGO_DB
- NV_AUTH_JWT_ISSUER
- NV_AUTH_JWT_AUDIENCE
- NV_AUTH_ACCESS_TTL_SEC
- NV_AUTH_REFRESH_TTL_SEC
- NV_AUTH_MAX_LOGIN_ATTEMPTS
- and other auth-specific env keys

No `.env` parsing in Auth itself.

---

## 11. Failure Modes & Operator Guidance

### 11.1 Credential Backend Down
- login-initiate / login-complete fail with 503
- problem+json:
  - `code: "AUTH_BACKEND_UNAVAILABLE"`

### 11.2 Token Signing Failure
- return 500
- log with:
  - key identifier
  - operation
  - requestId

### 11.3 DB Issues
- map via existing DbWriter error semantics
- duplicate constraints for identities (e.g. email uniqueness) yield 409 with `DUPLICATE_CONTENT`

---

## 12. Roadmap

### Phase 1 (MVP)
- Email+code login for fans.
- Basic access + refresh tokens.
- Simple identity roles.

### Phase 2
- Venue and act onboarding flows.
- OAuth / social login.
- Basic device binding.

### Phase 3
- S2S token minting.
- Admin UI for role management.
- Per-feature scopes.

### Phase 4
- Multi-region token validation.
- Hardware-backed keys (KMS/HSM).
- More advanced anomaly detection and token revocation strategies.

---

End of LDD-28.
