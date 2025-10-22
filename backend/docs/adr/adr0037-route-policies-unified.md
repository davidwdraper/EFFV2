# ADR-0037: Unified Route Policies (Edge + S2S)

## Context
The NowVibin backend currently uses a `routePolicies` collection to define exceptions for publicly accessible API endpoints (e.g., `/health`, `/jwks/keys`). These entries allow bypassing of standard bearer token requirements for specific routes at the **gateway** and **service** level. However, the system is evolving toward more comprehensive and configurable policy enforcement that includes **Service-to-Service (S2S)** authorization.

Until now, S2S bearer logic has been hard-coded: if a token is missing, the request fails; if a token is present, it is validated. This rigid behavior lacks fine-grained control and does not reflect the flexibility needed for future operations where certain internal routes may be public or restricted to specific calling services.

To address this, we unify **Edge** and **S2S** policy definitions into a single collection, `route_policies`, improving readability, configurability, and maintainability while maintaining the fail-fast security stance.

## Decision
- The `route_policies` collection replaces the old `routePolicies` collection for naming consistency with other DB collections (`service_configs`, etc.).
- Both Edge (public) and S2S (internal) policies coexist in the same collection, distinguished by a `type` field.
- Each policy record defines a single service route (`method` + `path`) and dictates whether bearer tokens are required.

### Schema
**Collection Name:** `route_policies`

| Field | Type | Description |
|--------|------|-------------|
| `_id` | ObjectId | Mongo-assigned identifier |
| `svcconfigId` | ObjectId | Foreign key to `service_configs` |
| `slug` | string | Redundant human-readable slug (unindexed) |
| `type` | string | Either `"Edge"` or `"S2S"` |
| `method` | string | HTTP method (GET, POST, PUT, PATCH, DELETE) |
| `path` | string | Service-local path, e.g. `/v1/health` |
| `bearerRequired` | boolean | Whether bearer token must be presented |
| `enabled` | boolean | Whether policy is active |
| `allowedCallers` | string[] (S2S only) | Optional list of service slugs permitted to call |
| `scopes` | string[] (S2S only) | Optional list of claim scopes (future use) |
| `updatedAt` | string (ISO date) | Last modification timestamp |
| `notes` | string | Optional operator note |

### Indexes
A unique compound index enforces one policy per route/method/type per service:
```
{ svcconfigId: 1, type: 1, method: 1, path: 1 }
```
`slug` is intentionally **not indexed** to preserve flexibility and listing readability.

### Behavioral Rules
- **Edge policy (public gateway access)**
  - If a matching `Edge` policy exists with `bearerRequired=false`, the route may be called anonymously.
  - Otherwise, the route is considered **protected**, and a valid S2S token is required.

- **S2S policy (internal service-to-service)**
  - If no record exists, the default is secure: **bearerRequired=true**.
  - If a record exists and `bearerRequired=false`, the receiver may allow unauthenticated S2S calls (e.g., health).
  - If `allowedCallers` is defined, only those caller service slugs are permitted after token validation.

- **Defaults**
  - `Edge`: No record → protected (bearer required)
  - `S2S`: No record → bearer required

### Enforced Flow
1. **SvcClient (Outbound)**
   - Checks the target route’s S2S policy.
   - If no policy or `bearerRequired=true`, mints and attaches a bearer.
   - If `bearerRequired=false`, skips minting.

2. **AppBase (Inbound Middleware)**
   - Resolves matching S2S policy.
   - If no policy exists → require bearer (fail-fast).
   - If `bearerRequired=true` → validate token and enforce `allowedCallers`.
   - If `bearerRequired=false` → skip validation (rare; only for health).

3. **Gateway (Public Edge)**
   - Uses `Edge` policies for deciding whether a route can be public.
   - Gateway never forwards client `Authorization` headers.
   - Always mints its own S2S token for worker calls, unless policy dictates otherwise.

## Consequences
- Simplifies operational management: one policy table covers all access contexts.
- Futureproof: easily extendable with new `type` values or scopes.
- Security posture remains fail-fast and default-protected.
- Explicit policy definition for every exception; no silent defaults.
- Human readability improved via redundant `slug` field.

## Implementation Notes
1. All legacy `routePolicies` data is deleted; fresh entries will be inserted post-schema deployment.
2. `route_policies` contract implemented via Zod (see `route_policies.contract.ts`).
3. Facilitator mirror will expose both Edge and S2S policies to Gateway and services.
4. Smoke tests will confirm:
   - Public Edge routes (e.g., `/health`, `/jwks/keys`) accessible without bearer.
   - All other routes require valid S2S tokens.
5. AppBase and SvcClient will branch on policy type accordingly.

## Alternatives Considered
- **Separate collections (route_policies_edge, route_policies_s2s):** Rejected for unnecessary duplication and code complexity.
- **Embed S2S policy inside service_configs:** Rejected; violates single-responsibility principle and complicates mirror refresh.

## References
- ADR-0031 — Route Policy Gate (foundation)
- ADR-0032 — Route Policy Gate: Design + Pipeline
- ADR-0033 — Internal-Only Services & Verification Defaults
