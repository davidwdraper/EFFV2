adr0074-db-state-and-env-guardrail
==================================

# ADR-0074 — DB_STATE, getDbVar(), getVar() Guardrail, and `_infra` Database Suffix

## Context

NowVibin services operate in two distinct classes of databases:

1. **Domain databases** — stateful, environment-dependent DBs used by CRUD services  
   Example: user, acts, places, events, credits, env-service, svcconfig.

2. **Infrastructure databases** — state-invariant DBs that must remain stable across all deployment states  
   Example: logging, WAL/audit, test-runner registry, and future telemetry services.

To support multi-state deployments (dev, smoke, staging, prod) **without ever allowing a service to accidentally point at the wrong database**, we require explicit state qualification for all domain DBs.

At the same time, we must prevent misuse of getVar() to read DB-sensitive configuration, because that creates silent production hazards.

The runtime environment service (env-service) must therefore provide:

- One canonical **DB_STATE** value
- All domain DB names suffixed with `_STATE`
- A guardrail preventing getVar() from reading DB variables
- A dedicated accessor getDbVar() for stateful DB variables
- A suffixing rule for state-invariant infrastructure DBs (`_infra` appended)

This ADR records the final, locked-in design.

---

## Decision

### 1. **DB_STATE is required for all domain services**

Every domain service reads its database name as:

${NV_MONGO_DB}_${DB_STATE}

Domain DBs *always* vary with state.

### 2. **State-invariant databases must use the `_infra` suffix**

Infrastructure DBs are forbidden from varying with DB_STATE.  
They instead follow:

${NV_MONGO_DB}_infra

### 3. **getVar() MUST NOT return database-related variables**

To prevent production-destroying mistakes, getVar() enforces:

- If a key is DB-sensitive (`NV_MONGO_*`, collection names, host/port, DB_STATE), getVar() throws.

### 4. **getDbVar() is the only API allowed to access DB configuration**

getDbVar():

- Validates that DB_STATE exists
- Applies suffix rules (`_state` vs `_infra`)
- Guarantees correctness across services

### 5. **Env-service is the single authority for DB vars**

Every service boot sequence pulls DB vars only through svcEnvDto → getVar()/getDbVar().  

---

## Consequences

- Prevents catastrophic cross-environment DB contamination.
- Smoke tests can safely accumulate data without cleanup.
- Strong separation between domain vs infrastructure data.

---

## Implementation Notes

- Add DB_STATE to env-service DTOs.
- Add getDbVar() with suffix rules.
- Modify getVar() to refuse DB vars.
- Update templates to use getDbVar().

---

## References

- LDD-36 (DB_STATE & Guardrail Architecture)
- ADR-0039, ADR-0044
