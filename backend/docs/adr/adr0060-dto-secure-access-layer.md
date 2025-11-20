# adr0060-dto-secure-access-layer

## Context

NV services rely on DTO-first design. DTOs are the single source of truth for all
domain data and configuration. Historically, DTO fields were declared as public
properties, allowing any consumer—gateway, workers, internal pipelines—to freely
read or mutate DTO internals. This created several long-term risks:

- No guardrails against accidental mutation of critical configuration fields.
- No distinction between admin-level operations and normal service reads.
- Inability to guarantee that svcconfig values (ports, enable flags, userType
  thresholds, etc.) are only modified by authorized users.
- No mechanism to prevent drift: code could mutate DTOs without using sanctioned
  update endpoints or pipelines.

As NV grows, particularly with configuration-oriented services like `svcconfig`
and `env-service`, relying on convention (“please do not touch this field
directly”) is operationally unsafe.

A secure layer is required around DTO field access.

---

## Decision

We introduce a **DTO Secure Access Layer**, implemented in `DtoBase`, and
adopted by DTOs that require field-level authorization.

### Key Elements

1. **Private Field Storage**

   DTOs store internal data in *private underscored fields* (e.g. `_slug`,
   `_env`, `_targetPort`). These cannot be accessed from outside the DTO.

2. **Access Map**

   Each participating DTO defines a static `access` map:

   ```ts
   public static readonly access = {
     slug: { read: UserType.Anon, write: UserType.AdminSystem },
     targetPort: { read: UserType.Anon, write: UserType.AdminRoot },
     ...
   };
   ```

   Each field *must* have an explicit rule. Missing rules cause a hard failure —
   no fallbacks, no defaults.

3. **Secure Getter/Setter Wrappers**

   DTOs expose getters and setters:

   ```ts
   public get slug() { return this.readField("slug"); }
   public set slug(v) { this.writeField("slug", v); }
   ```

   These wrappers call `DtoBase.readField` and `DtoBase.writeField`, which
   enforce access rules.

4. **Access Enforcement in DtoBase**

   - `readField()` checks:
     - Does an access rule exist?
     - Does caller’s `UserType` meet the read requirement?
   - `writeField()` checks:
     - Does an access rule exist?
     - Does caller’s `UserType` meet the write requirement?
   - Violations throw explicit, Ops-friendly errors.

5. **Current UserType Injection**

   Pipelines or the Registry assign the caller’s UserType:

   ```ts
   dto.setCurrentUserType(ctx.userType);
   ```

   This determines permissible access throughout the lifecycle. Eventually, this
   will be sourced from decoded JWTs.

6. **Double Guardrail Model**

   - First guardrail: gateway + route-level authorization (CRUD-level access).
   - Second guardrail: DTO-level field protection.

   Even if a route is misconfigured, DTO rules prevent unauthorized writes.

---

## Consequences

### Positive

- Strong domain invariants: critical fields cannot be modified by unauthorized
  code.
- Clear separation between:
  - admin console write operations
  - normal gateway/worker read-only operations
- Eliminates silent configuration drift.
- Ensures DTOs remain the authoritative and secure storage of state.
- Encourages DTO-first discipline by forcing explicit field governance.

### Negative

- Requires DTO authors to define an `access` map for each secured field.
- Slightly increases boilerplate for getters/setters.
- Other DTOs not yet migrated continue using legacy public fields until updated.

---

## Implementation Notes

- Only DTOs that define an `access` map participate in the secure access layer.
- DTOs may be migrated gradually.
- `fromJson()` and internal hydration bypass getters/setters intentionally; they
  operate as trusted internal paths.
- Setter wrappers perform normalization (e.g. `Math.trunc`) before assignment.
- `writeField` must never generate values or guess defaults.

---

## Alternatives Considered

### A. Route-only Authorization  
Rejected. Route-level auth cannot guarantee invariants inside pipelines or
internal library code.

### B. Proxy-based Field Interception  
Rejected. Too magical, breaks easily, harder to reason about, not aligned with
NV’s explicit architecture.

### C. Leaving DTOs unprotected  
Rejected. Too risky, impossible to guarantee safe configuration.

---

## References

- SOP: DTO-first; no leaked shapes; DTO is the final authority.
- ADR-0040, ADR-0045, ADR-0050, ADR-0053, ADR-0057
- NV Security Model drafts (S2S rail, JWT user roles)

