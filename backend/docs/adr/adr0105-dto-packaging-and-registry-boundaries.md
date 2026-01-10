adr0105-dto-packaging-and-registry-boundaries

## Context

NV originally colocated all DTO classes inside a single shared project.  
This created a hidden but severe operational coupling:

- Adding a new DTO (which is common and expected) requires modifying the shared project.
- Modifying shared forces rebuilds and regression risk across _all_ services.
- Over time, this makes feature delivery feel like platform migration.

Separately, recent refactors exposed a second problem:

- The DTO Registry (runtime DTO creation vocabulary) was being conflated with
  boot-time persistence responsibilities (index ensuring).
- This caused services (e.g., env-service) to attempt to ensure indexes for
  collections they do not own.

NV requires:

- Cross-service DTO hydration without cross-service persistence coupling.
- The ability to add new DTOs without forcing global service rebuilds.
- Clear separation between _DTO identity_, _DTO creation_, and _DB ownership_.

This ADR formalizes the corrected model.

---

## Decision

### 1. DTOs are packaged as independent, versioned units

Each shared DTO is its own package.

- Canonical identity remains the **dtoKey**, e.g.:
  - `db.env-service.dto`
  - `db.user-auth.dto`
- Packaging convention:
  - `@nv/dto/db.env-service.dto`
  - `@nv/dto/db.user-auth.dto`

Each DTO package exports:

- `DTO_KEY` (string, canonical)
- DTO constructor (class)
- `DTO_KIND` (`db | api | wire | tmp`)
- Optional descriptor object for registry consumption

DTO classes **remain code**, never DB-defined.

This allows:

- Selective service upgrades
- No forced global rebuilds
- DTOs as stable, shared “islands”

---

### 2. The DTO Registry is global per process, but descriptor-driven

The Registry:

- Is instantiated per service process
- Consumes a list of DTO descriptors
- Provides **only** runtime DTO creation (`create(dtoKey, ...)`)
- Does **not** own persistence or index logic

The Registry:

- Does not know which service “owns” a DTO
- Does not ensure indexes
- Does not read env configuration

It is a pure creation vocabulary.

---

### 3. DB index responsibility is service-owned, not registry-owned

Each service declares (at runtime) which **db dtoKeys it owns**.

Sources for ownership:

- Service-local declaration (initially)
- Later: env-service DB configuration

At boot:

- The service resolves owned dtoKeys against the global registry
- Fails fast if a declared dtoKey is missing
- Ensures indexes **only** for those DTOs

No service ensures indexes for another service’s collections.

---

### 4. No duplication of DTO definitions

There is:

- One DTO class definition (in its package)
- One canonical dtoKey
- One registry entry per process (derived from installed packages)

Service manifests reference dtoKeys; they do not redefine DTOs.

---

## Consequences

### Positive

- Adding a new DTO does not force global rebuilds
- Cross-service DTO hydration remains supported
- DB ownership boundaries are explicit and enforceable
- Registry responsibility is sharply constrained
- Boot failures become meaningful and local

### Tradeoffs

- DTO packaging introduces more packages (intentional)
- Registry must be descriptor-driven (one-time refactor)
- Services must explicitly declare DB ownership

These tradeoffs are acceptable and align with NV’s scale goals.

---

## Invariants

- dtoKey is globally unique and stable
- Package name must correspond exactly to dtoKey
- DB DTOs must never be index-ensured outside their owning service
- Registry must not perform boot-time work
- Env-service controls configuration, not code distribution

---

## References

- ADR-0044 (DbEnvServiceDto contract)
- ADR-0045 (Index Hints — boot ensure)
- ADR-0080 (SvcRuntime)
- ADR-0102 (Registry sole DTO creation authority)
