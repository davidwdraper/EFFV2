adr0086-mos-safe-dto-mint-capability

# ADR-0086 — Posture-Safe DTO Mint Capability (Registry-Free)

## Context

NV services declare a boot-time **posture** (`SvcPosture`) which constrains what capabilities the service may own and access.

Current allowed postures are:

- `mos` — orchestration-only (no DB, no filesystem)
- `db` — database-owning services (indexes/boot checks/persistence)
- `api` — external adapter services (talk to third-party APIs)
- `fs` — filesystem-owning services (local file IO)
- `stream` — stream/queue oriented services
- `gateway` — the public edge proxy service

The posture rail exists to keep services honest: **capabilities must be explicit**, and posture is the *single source of truth* for what a service may do at boot and at runtime.

A recurring need spans *all* postures: services must be able to **mint DTOs** to:
- hydrate payloads from the wire (bag → DTO)
- validate DTOs via canonical accessors
- emit canonical JSON via `dto.toJson()` for S2S calls
- wrap/unwrap via `DtoBag` at controller boundaries

Today, DTO minting is frequently coupled to `DtoRegistry` access. That coupling is incorrect because the full `DtoRegistry` implies DB-focused responsibilities (index hints, collection binding, boot-time DB validation, persistence helpers). This causes posture violations when non-`db` services (e.g., `mos`, `api`, `gateway`) try to mint DTOs and accidentally reach for `getDtoRegistry()`.

This surfaced in the test-runner flow: a non-`db` service attempted to access the registry purely to mint DTOs, and correctly hard-failed under the posture rails.

## Decision

We separate **DTO minting** from **DTO registry** responsibilities, and make DTO minting posture-safe.

### 1) Introduce a posture-safe DTO mint capability (shared)

Introduce a new shared capability (example name):

- `IDtoMint` / `DtoMint`

Responsibilities:
- Construct DTO instances by `dtoType`
- Validate DTOs using DTO-owned validation/accessors
- Build DTOs from JSON (wire-safe)
- Optionally build/validate `DtoBag` envelopes

Non-responsibilities:
- No collection binding
- No index hints
- No persistence helpers
- No DB boot checks

This capability is valid for **all postures** (including `mos`, `api`, `fs`, `stream`, `gateway`, and `db`).

### 2) Keep the DB registry DB-only

`DtoRegistry` remains a **DB-posture-only** capability, used for DB-specific concerns:
- index hints / ensureIndexes
- DB boot validation
- persistence helper context (collection selection, etc.)

Access to the DB registry remains posture-gated (e.g., `AppBase.getDtoRegistry()` continues to throw unless the service is `db` posture).

### 3) Wire mint via SvcRuntime, not via registry

The DTO mint capability is:
- wired once in `AppBase.wireRuntimeCaps()`
- exposed through `SvcRuntime` (e.g., `rt.getCap("dto.mint")`)
- explicit and fail-fast if misconfigured (no fallbacks)

### 4) External DTOs are the mint surface for cross-service contracts

Cross-service DTOs are already required to live in:

- `backend/services/shared/src/dto`

Non-`db` services mint DTOs primarily from this shared surface to build S2S payloads and hydrate wire responses without importing DB concerns.

## Consequences

### Positive
- All postures can safely mint DTOs without accidentally pulling in DB registry semantics
- DB posture remains meaningful and enforceable
- Eliminates pressure to “just give non-DB services a registry”
- Improves separation between wire concerns (DTO mint) and persistence concerns (DB registry)

### Trade-offs
- Adds a new shared capability surface to maintain
- Requires explicit constructor maps (or equivalent) for DTO types used by a service

### Explicitly Rejected
- Allowing non-`db` services to access `DtoRegistry`
- Adding persistence metadata to the mint surface
- Implicit fallbacks/default registries or auto-discovery “magic”

## Implementation Notes

- New shared interface (example):
  - `IDtoMint` with `getCtor(dtoType)`, `fromJson(dtoType, json, opts)`, and optional bag helpers
- Runtime cap key: `"dto.mint"` (or equivalent)
- `AppBase.wireRuntimeCaps()` wires the cap factory
- Services use mint for:
  - wire hydration (bag/json → DTO)
  - bag construction for S2S payloads
  - validation via DTO accessors
- Only `db` posture services call `getDtoRegistry()`; all others must avoid it entirely.

## Alternatives

1) **Give non-`db` services a partial registry**  
   Rejected — posture semantics blur and DB concerns leak.

2) **Duplicate DTO constructors in each service**  
   Rejected — drift and contract inconsistency.

3) **Registry read-only for non-`db`**  
   Rejected — still couples non-DB services to DB-focused surfaces and weakens rails.

## References

- ADR-0044 — EnvServiceDto — Key/Value Contract
- ADR-0073 — Test-Runner Service — Handler-Level Test Execution
- ADR-0080 — SvcRuntime — Transport-Agnostic Service Runtime
- ADR-0084 — Service Posture & Boot-Time Rails
- NowVibin Backend — Core SOP (Reduced, Clean)
