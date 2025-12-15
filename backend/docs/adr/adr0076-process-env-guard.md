adr0076-process-env-guard

# ADR-0076 — Guard and Lock `process.env` After Bootstrap

## Context

The NowVibin backend enforces **EnvServiceDto as the single canonical source** of non-secret runtime configuration.  
All services (including gateway, workers, MOS, and daemons) must obtain configuration via:

- env-service (DB-backed, reloadable)
- EnvServiceDto.getEnvVar(...)
- DtoBag merge semantics (root + service)

Despite this, it remains trivially easy for developers (including future maintainers) to bypass these rails by reading directly from `process.env`, which leads to:

- silent configuration drift
- non-reloadable values
- dev/prod divergence
- boot-order bugs that “work by luck”
- test behavior that does not reflect production reality

Linting alone is insufficient; runtime enforcement is required to guarantee invariants.

---

## Decision

Introduce an **optional but strict runtime guard** that **blocks access to `process.env` after bootstrap completes**, enforced via a `Proxy`.

The guard is controlled by a new environment flag:

```
NV_PROCESS_ENV_GUARD=true
```

When enabled:

- `process.env` access is **allowed only**:
  - during early bootstrap
  - for a small, explicit allowlist of bootstrap/runtime-safe keys
- Any other access **throws immediately** with actionable Ops guidance

The guard is **opt-in**, explicit, and fail-fast.

---

## Design

### High-Level Behavior

1. At process start, `process.env` is wrapped in a `Proxy`.
2. During bootstrap, env access is permitted.
3. After envBootstrap completes, the guard is **locked**.
4. Any subsequent access to disallowed keys throws.

### Allowed Keys (Initial Allowlist)

The allowlist is intentionally minimal and conservative:

- `NV_ENV`
- `NV_MONGO_URI`
- `NV_MONGO_DB`
- `NV_ENV_SERVICE_URL`
- `NV_SVCCONFIG_URL`
- `NODE_ENV`
- `PATH`

All other configuration **must** come from `EnvServiceDto`.

### Error Semantics

Illegal access throws with a clear, Ops-focused message:

- what key was accessed
- when (post-bootstrap)
- how to fix it (use `EnvServiceDto.getEnvVar(...)`)

This turns configuration drift into an **impossible-to-ship failure**, not a debugging exercise.

---

## Consequences

### Positive

- Enforces DTO-first configuration **at runtime**, not just by convention
- Eliminates a whole class of “worked before, broken now” boot bugs
- Makes env-service the unquestioned source of truth
- Aligns tests, dev, and prod behavior
- Improves operator triage with deterministic failures

### Trade-offs

- Requires discipline around bootstrap ordering
- Third-party libraries that read arbitrary env vars must do so **before the guard is locked**
- Guard must be introduced carefully and incrementally

These trade-offs are acceptable and controlled.

---

## Implementation Notes

- Guard implementation lives in shared (e.g. `shared/src/env/envGuard.ts`)
- Guard activation is conditional on `NV_PROCESS_ENV_GUARD=true`
- Guard is locked explicitly after envBootstrap completes
- ESLint `no-restricted-properties` rule on `process.env` is recommended as a complementary rail
- env-service bootstrap remains exempt and continues to read required DB connection vars directly from `process.env`

---

## Alternatives Considered

### 1. ESLint-only enforcement  
Rejected — does not protect runtime, tests, or dynamically generated code.

### 2. Freezing `process.env`  
Rejected — breaks Node internals and third-party libraries.

### 3. Global ban with no bootstrap window  
Rejected — incompatible with legitimate early bootstrap requirements.

The selected approach provides **maximum enforcement with minimal collateral risk**.

---

## References

- ADR-0039 — env-service centralized non-secret env
- ADR-0044 — EnvServiceDto key/value contract
- LDD-02 — Boot Sequence
- LDD-03 — envBootstrap & SvcClient
- SOP — Environment Invariance & Fail-Fast Boot
