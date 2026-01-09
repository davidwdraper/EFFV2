adr0104-drop-getType-and-standardize-dtoKey

## Context

NV DTOs originally exposed `getType()` as a wire discriminator, inherited from an earlier JSON-centric design (`toJson` / `fromJson`). As the backend evolved toward a registry-driven, controller-owned architecture, `getType()` has become:

- redundant with registry keys,
- insufficient for cloning and factory operations,
- a source of ambiguity (pretty type vs registry identity),
- and an obstacle to clean, deterministic DTO creation.

At the same time, NV now has:

- a **global DTO registry** as the sole construction authority,
- **controller-owned semantics** (controllers know what they expect),
- and **no legacy clients or backward-compatibility requirements**.

This creates an opportunity to simplify the DTO contract and remove drift.

## Decision

### 1) `getType()` is removed across the codebase

- All DTOs **MUST NOT** implement `getType()`.
- All code depending on `getType()` is intentionally broken and must be refactored.
- No shims, aliases, or compatibility layers are permitted.

### 2) `dtoKey` replaces `getType()` as the canonical DTO identifier

- `dtoKey` is the **registry key** (e.g. `"db.user.dto"`).
- `dtoKey` uniquely identifies:
  - the DTO constructor,
  - its registry entry,
  - its associated collection name (if applicable).

There is no separate “pretty type” string at the DTO level.

### 3) Controllers own the responsibility for determining `dtoKey`

In all scenarios, **the controller determines the dtoKey** and passes it explicitly into the registry.

Valid sources include:

- **Hard-coded dtoKey**  
  Used by single-purpose controllers (e.g. signup, auth, env-service config).

- **Route parameters**  
  Used by generic typed controllers (e.g. `/:dtoKey/:id`).

- **Wire metadata (headers or payload)**  
  Used only when a controller’s API contract explicitly requires it.

There is no implicit inference and no fallback behavior.

### 4) The registry is the only place DTOs are constructed or cloned

- Controllers call:
  - `registry.create(dtoKey, body?, opts?)`
  - `registry.cloneCreate(dtoKey, body, opts?)`
- DTOs are never constructed directly.
- DTOs do not need to know their own `dtoKey`.

### 5) `dtoKey` is construction metadata, not domain data

- `dtoKey` **MUST NOT** be persisted to MongoDB.
- `dtoKey` **MUST NOT** be treated as part of the DTO’s domain fields.
- If needed for logging or orchestration, `dtoKey` lives in:
  - controller context,
  - handler context,
  - bag metadata,
  - or registry logic.

DTO instances remain pure domain containers.

## Consequences

### Positive

- Deterministic DTO creation and cloning.
- Simplified DTO interfaces.
- Elimination of drift between wire types and registry entries.
- Cleaner controller contracts.
- Easier refactors and future DTO evolution.

### Breaking Changes

- All usages of `getType()` must be removed.
- Wire envelopes, BagBuilder logic, and handlers must be updated to use `dtoKey`.
- Tests relying on `getType()` must be rewritten.

This is intentional and acceptable.

## Implementation Notes

- DTO interfaces (`IDto`) will be updated to remove `getType()`.
- Registry APIs will standardize on `dtoKey`.
- BagBuilder and wire adapters will be updated accordingly.
- No compatibility logic will be added.

## Alternatives Considered

- Keeping `getType()` alongside `dtoKey`  
  ❌ Rejected: duplicates responsibility and causes drift.

- Embedding `dtoKey` inside DTO instances  
  ❌ Rejected: mixes construction metadata with domain data.

## References

- ADR-0102 — Registry sole DTO creation authority
- ADR-0103 — DTO naming conventions
- ADR-0050 — Wire bag envelope
