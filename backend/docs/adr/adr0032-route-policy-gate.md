# adr0032-route-policy-gate

## Context

As NowVibin expands to include multiple microservices—each handling different aspects of user, authentication, audit, and event data—the need arose to enforce **route-level access control** at the **Gateway** layer, with authoritative policy data served by the **SvcFacilitator** service.

Historically, authorization was left to downstream services. This design created two core issues:

1. **Inconsistent enforcement** — each service applied its own access logic.
2. **Excessive coupling** — downstream services had to understand user types and gateway behavior.

To resolve these, route-level access policies must be enforced **upstream**, before traffic reaches any business logic.

## Decision

We introduce a **Route Policy Gate** at the Gateway level, paired with **Route Policy endpoints** within the Facilitator.

### Design Overview

- **RoutePolicyGate (Gateway middleware):**

  - Looks up the policy for the incoming route based on `(svcconfigId, method, path)`.
  - Maintains a **TTL cache** for both positive and negative results.
  - Uses **SvcFacilitator** to resolve policies on cache misses.
  - Sets `req.routePolicyMinAccessLevel` and `req.routePolicyFound` for downstream token gates.
  - Default stance: **private by default** (no policy = deny for anonymous).

- **SvcFacilitator (service):**
  - Owns canonical routePolicy data in MongoDB.
  - Enforces uniqueness by `{ svcconfigId, version, method, path }`.
  - Exposes CRUD endpoints for policies under `/api/svcfacilitator/v1/routePolicy`.
  - Provides lookup interface used by the Gateway via GET.

### Middleware Rule Matrix

| Case | JWT Present | RoutePolicy Found | minAccessLevel | Result                                |
| ---- | ----------- | ----------------- | -------------- | ------------------------------------- |
| 1    | ❌          | ❌                | n/a            | ❌ Block (private by default)         |
| 2    | ❌          | ✅                | 0              | ✅ Allow (public route)               |
| 3    | ❌          | ✅                | >0             | ❌ Block (requires token)             |
| 4    | ✅          | ❌                | n/a            | ✅ Allow (validation deferred)        |
| 5    | ✅          | ✅                | any            | ✅ Allow (token gate enforces access) |

### Caching & TTL

- Cache key: `{svcconfigId}|{method}|{path}` (no version)
- TTL: configured via `GATEWAY_ROUTE_POLICY_TTL_MS`
- Negative results are cached to reduce facilitator load.
- Facilitator GET requests timeout after `ROUTE_POLICY_FETCH_TIMEOUT_MS` (default 5000ms).

### Environment Invariance

No literals, no fallbacks. Required environment variables:

```
SVCFACILITATOR_BASE_URL
GATEWAY_ROUTE_POLICY_TTL_MS
ROUTE_POLICY_FETCH_TIMEOUT_MS (optional)
```

If any are missing, the gateway fails fast on startup.

### Security Principles

- The **Gateway** is the only public entry point.
- RoutePolicyGate enforces **anonymous-block-by-default**.
- Authenticated users’ access is later enforced by the **Token Validation Gate**.
- Separate log streams:
  - **SECURITY** (guardrail denials)
  - **WAL** (audit trail for successful calls).

## Consequences

**Positive:**

- Unified access model across all services.
- Facilitator centralizes route-level access rules.
- Reduced security drift and audit overhead.

**Negative:**

- Additional latency on cold cache misses.
- Facilitator dependency required at Gateway runtime.

## Implementation Notes

- Implemented at Gateway: `backend/services/gateway/src/middleware/routePolicyGate.ts`
- Integrated in orchestration order **before** WAL audit ring in `app.ts`.
- Facilitator repo defines persistence model and CRUD controller for routePolicy records.
- CLI tooling added (`backend/tools/route-policy-cli`) for idempotent policy management.

## Alternatives Considered

1. **Embed policies directly in svcconfig documents**  
   → Rejected for violating single-responsibility; svcconfig defines service-level info, not route-level access.

2. **Push enforcement downstream (Auth service)**  
   → Rejected: breaks principle of defense-in-depth and makes routing nondeterministic.

3. **Gateway hardcoded access matrix**  
   → Rejected: violates environment invariance and central configuration goals.

## References

- ADR-0007 — SvcConfig Contract — fixed shapes & keys
- ADR-0020 — SvcConfig Mirror & Push Design
- ADR-0029 — Contract-ID + BodyHandler pipeline
- ADR-0033 — Environment Loader and Fail-Fast Boot
- ADR-0036 — Facilitator Index Invariants
