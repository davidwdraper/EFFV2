adr0038-authorization-hierarchy-and-enforcement

# ADR-0038 — Authorization Hierarchy and Enforcement

## Context

NowVibin operates a unified backend shared by both:

- the **NV App** (public-facing client through `gateway`), and
- the **NV Console** (administrative client through `gatewayAdmin`).

Both layers communicate through the same backend microservices.
To ensure consistent access control, we must formalize a single immutable
authorization hierarchy and enforcement model that scales across all services.

## Decision

We adopt a **UserType-based authorization model** with a fixed integer hierarchy.

### Immutable UserType Levels

| Value | Name          | Description                                                                                     |
| :---- | :------------ | :---------------------------------------------------------------------------------------------- |
| 0     | Anonymous     | Unauthenticated visitor. Access limited to public routes (health, discovery).                   |
| 1     | Free User     | Registered account with no paid tier.                                                           |
| 2     | Low-Fee User  | Basic paid tier with minimal privileges.                                                        |
| 3     | High-Fee User | Premium paid tier.                                                                              |
| 4     | Admin L1      | Operational viewer: can view Ops dashboards and logs, but cannot mutate persistent data.        |
| 5     | Admin L2      | Operational editor: can modify operational data such as `service_configs` and `route_policies`. |
| 6     | Admin L3      | Super admin: full operational control, including kill switches and system toggles.              |

|

These values are **immutable** and consistent across all services and tokens.

### Enforcement Rules

1. **UserType Propagation**

   - Every JWT issued by Auth must include `userId` and `userType` claims.
   - Gateways decode these and attach `req.user = { id, type }` to inbound requests.
   - S2S calls inherit these claims through internal minting (for admin tokens).

2. **Authorization Check**

   - Shared middleware `requireUserType(minType)` verifies the caller’s privileges.
   - Requests with insufficient `userType` are denied with HTTP 403 and a structured `problem+json` response.

   ```ts
   if (req.user?.type < minType)
     throw problem(
       403,
       "forbidden",
       `userType ${req.user?.type} insufficient; requires >= ${minType}`
     );
   ```

3. **Minimum Levels**

   - `service_configs` and `route_policies` modifications require `userType >= 5`.
   - Read operations may be open to `userType >= 4` depending on route policy configuration.
   - All other microservices follow route policy-based access rules layered on top of this hierarchy.

4. **Operational Metadata**

   - Each DB document for `service_configs` and `route_policies` includes `changedByUserId` (string).
   - This field records the last modifying user for ops reporting only; it is never used in runtime authorization logic.

5. **Security Logging**

   - All denied modification attempts are logged as SECURITY events with:
     - service name
     - userId
     - userType
     - required minimum
     - method and path

6. **System Context**
   - Automated system actions (mirror rebuilds, migrations) use `userType = 6` and `changedByUserId = "system"`.

### Example Middleware

```ts
export function requireUserType(minType: number) {
  return (req, res, next) => {
    const type = req.user?.type ?? 0;
    if (type < minType) {
      return res.status(403).json({
        type: "about:blank",
        title: "forbidden",
        status: 403,
        detail: `userType ${type} insufficient; requires >= ${minType}`,
      });
    }
    next();
  };
}
```

### Example Enum (shared/types/userType.ts)

```ts
export enum UserType {
  Anon = 0,
  Free = 1,
  LowFee = 2,
  HighFee = 3,
  Admin1 = 4,
  Admin2 = 5,
  Admin3 = 6,
}
```

## Consequences

- Enforces consistent, predictable privilege separation across all gateways and services.
- Prevents accidental privilege escalation by requiring explicit thresholds.
- Simplifies admin console integration — backend already enforces hierarchy.
- Enables structured SECURITY logging for all denied admin attempts.

## Implementation Notes

- Middleware lives in `shared/src/middleware/requireUserType.ts`.
- Enum lives in `shared/src/types/userType.ts`.
- All admin CRUD routes for `service_configs` and `route_policies` mount `requireUserType(5)`.
- S2S system operations always act with `userType=6`.

## Alternatives Considered

- Role strings (`"admin"`, `"editor"`, etc.): rejected for lack of immutability and performance overhead.
- Policy-based dynamic role matrix: overkill for current stage; hierarchy suffices and remains easy to audit.

## References

- SOP: `docs/architecture/backend/SOP.md (Reduced, Clean)`
- ADR-0031 — Route Policy Gate (Foundation)
- ADR-0032 — Route Policy Gate (Design + Pipeline)
- ADR-0037 — Unified Route Policies (Edge + S2S)
