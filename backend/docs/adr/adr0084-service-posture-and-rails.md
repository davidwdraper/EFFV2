adr0084-service-posture-and-rails

# ADR-0084: Service Posture & Boot-Time Rails

## Context

As the NowVibin (NV) platform grows, services increasingly differ not by _what_ they do, but by _what they are allowed to own_. Historically, services expressed these differences implicitly via ad-hoc flags (e.g. `checkDb=true/false`) passed independently to `envBootstrap()` and `AppBase`. This duplication proved brittle and error‑prone, allowing services to “work by accident” when index.ts and app.ts drifted out of alignment.

Additionally, NV enforces a **one-service-per-interest** model:

- API adapters must not own databases.
- Filesystem (FS) and stream services are adapters, not persistence owners.
- Database ownership is explicit and rare.

At the same time, NV is introducing **Write‑Ahead Logging (WAL)** for all database writes, which requires filesystem backing for all DB‑owning services.

A single, explicit concept is required to:

- Declare what a service _is_
- Derive what it _may_ and _must_ do
- Enforce legality at boot time
- Eliminate duplicated, drifting configuration flags

## Decision

Introduce **Service Posture** as a first‑class, single source of truth for service capabilities and boot‑time rails.

Each service declares exactly one `posture` in its entrypoint (`index.ts`). All other constraints (DB ownership, FS requirements, WAL enforcement, capability eligibility) are **derived**, not independently configured.

### Defined Postures

- `db` — Database‑owning service (entity / persistence services)
- `mos` — Orchestration service (no persistence)
- `api` — External API adapter
- `fs` — Filesystem adapter / worker
- `stream` — Stream / queue adapter / worker

### Core Invariants

1. **DB ownership is exclusive**

   - Only `db` posture services may own a database.
   - All other postures are forbidden from DB ownership.

2. **WAL is mandatory for DB services**

   - All `db` posture services perform writes.
   - All DB writes are WAL‑backed.
   - Therefore, filesystem access is _required_ for `db` posture services.

3. **Filesystem access is restricted**

   - FS access is permitted for `db` posture _only_ as a WAL substrate.
   - No handler code may directly access the filesystem.
   - WAL implementation is opaque and enforced at the DB adapter layer.

4. **No mixed interests**
   - `api`, `fs`, `stream`, and `mos` postures must not own databases.
   - If an API requires persistence, it must communicate via S2S with a DB‑owning service (requiring coordination by a MOS).

## Mechanics

### Declaration (Entry Point)

Each service declares its posture once in `index.ts`:

```ts
const POSTURE: SvcPosture = "db"; // or "mos", "api", "fs", "stream"
```

This value is passed unchanged to both:

- `envBootstrap({ posture })`
- `createApp({ posture, rt })`

### Derivation (Rails)

From `posture`, the platform derives boot‑time gates:

- `posture === "db"`

  - DB env vars required
  - WAL filesystem env vars required
  - Index ensure enabled

- `posture !== "db"`
  - DB env vars forbidden or ignored
  - WAL forbidden
  - No DB adapters or writers available

No service may directly specify `checkDb`, WAL flags, or filesystem permissions.

### Enforcement Points

1. **envBootstrap()**

   - Validates required environment variables based on posture
   - Fails fast on illegal posture/resource combinations

2. **AppBase**

   - Enforces posture legality
   - Enables or disables DB, WAL, and other rails accordingly
   - Exposes only posture‑legal capabilities to handlers

3. **DB Write Adapters**
   - Always perform WAL writes prior to committing
   - Abstract filesystem access entirely away from handlers

## Consequences

### Positive

- Eliminates duplicated configuration (`checkDb` drift)
- Enforces architectural boundaries at boot time
- Makes service intent explicit and reviewable
- Prevents accidental DB ownership by non‑DB services
- Guarantees durability invariants (all DB writes are WAL‑backed)

### Trade‑offs

- Slightly more up‑front rigor when creating new services
- Requires updating existing services to declare posture

Both are acceptable and intentional.

## Alternatives Considered

1. **Multiple boolean flags (checkDb, enableWal, needsFs, …)**

   - Rejected: combinatorial drift, unreadable intent, brittle wiring

2. **Optional WAL via feature flag**

   - Rejected: durability must not be optional for DB writes

3. **Implicit posture inferred from code usage**
   - Rejected: impossible to enforce consistently or early

## References

- ADR‑0040 (DTO‑Only Persistence)
- ADR‑0044 (EnvServiceDto — Key/Value Contract)
- ADR‑0080 (SvcRuntime — Transport‑Agnostic Service Runtime)
- LDD‑35 (Service Runtime & Rails)
