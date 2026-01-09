adr0103-dto-naming-convention-keys-filenames-classnames

## Context

NV is hardening DTO identity rules (ADR-0102) and eliminating per-service registries in favor of a single shared DTO Registry.

As NV grows, “brain drain” occurs when:

- a DTO’s registry key differs from its file name,
- a DTO’s class name drifts from its registry identity,
- collection routing is inferred from inconsistent or informal naming,
- different services invent different registry key schemes.

Because DTOs are the most atomic, cross-cutting contract in NV, their naming must be:

- globally unique,
- deterministic,
- grep-friendly,
- enforceable at boot by the shared Registry.

This ADR defines the canonical naming convention for:

1. DTO registry keys
2. DTO file names
3. DTO class names

## Decision

### 1) Registry Key Format

All DTOs have exactly one canonical registry key with this format:

`<edge>.<type>.<optional...>.dto`

- Keys are globally unique across NV.
- Keys are lowercase, dot-separated.
- Hyphens are allowed inside segments (e.g., `user-auth`).
- Keys MUST end with `.dto`.

#### edge

`edge` indicates the DTO’s intent/scope:

- `db` — persisted domain DTOs (represent records in a DB collection)
- `tmp` — short-lived internal DTOs (never persisted)
- `api` — third-party API mapping DTOs (typically transformed into `db.*` or `tmp.*`)

Additional `edge` values may be introduced later, but must be explicit and documented.

#### type

- For `db.*`: `type` is the DB collection name (e.g., `user`, `user-auth`, `prompt`).
- For non-`db` DTOs: `type` is the best-fit noun for the DTO’s role (e.g., `login`).

#### optional segments

Optional segments may be appended to describe shape/usage variants, for example:

- `db.user.settings.dto`
- `db.user.audit.dto`
- `api.stripe.customer.dto`
- `tmp.login.credentials.dto`

### 2) DTO File Name Convention

The DTO file name MUST match the registry key exactly, with `.ts` appended:

`<registryKey>.ts`

Examples:

- Key: `db.user.dto` → File: `db.user.dto.ts`
- Key: `db.user-auth.audit.dto` → File: `db.user-auth.audit.dto.ts`
- Key: `tmp.login.dto` → File: `tmp.login.dto.ts`

This convention is strictly for determinism and grep-ability. `.ts` has no semantic meaning in production; the key is the canonical identity.

### 3) DTO Class Name Convention

The exported DTO class name MUST be derived deterministically from the registry key.

Algorithm:

Given registry key: `<edge>.<type>.<optional...>.dto`

1. Split by `.` into segments.
2. Drop the final segment `dto`.
3. For each remaining segment:
   - split by `-` into tokens
   - PascalCase each token
   - concatenate tokens back into one PascalCase segment
4. Concatenate all PascalCase segments.
5. Append `Dto`.

Examples:

- `db.user.dto` → `DbUserDto`
- `db.user-auth.dto` → `DbUserAuthDto`
- `db.user-auth.audit.dto` → `DbUserAuthAuditDto`
- `db.user.settings.dto` → `DbUserSettingsDto`
- `tmp.login.dto` → `TmpLoginDto`
- `api.stripe.customer.dto` → `ApiStripeCustomerDto`

Notes:

- Hyphenated type values (e.g., `user-auth`) remain intact in the key and become `UserAuth` in the class name.
- The class name is not a key and must never be used as a substitute for the key.

### 4) Collection Routing Rule (db.\*)

For `db.*` keys:

- The DB collection name is the SECOND dot-segment of the key (the `<type>` segment), preserved exactly (including hyphens).

Example:

- `db.user-auth.audit.dto` routes to collection `"user-auth"`.

NV MUST NOT attempt to derive the collection name from the DTO class name.

### 5) Shared Registry Enforcement

The shared DTO Registry MUST enforce at registration time:

For any registration `(key, Ctor)`:

- `key` must follow `<edge>.<type>.<optional...>.dto` and end with `.dto`.
- `Ctor.name` MUST equal the derived class name from the key (as defined above).
- For `db.*` keys:
  - `expectedCollection = key.split(".")[1]` (raw, including hyphens)
  - The Registry MUST store and use `expectedCollection` for DB routing.
  - If DTOs expose a static `dbCollectionName()` during migration, the Registry SHOULD validate:
    `Ctor.dbCollectionName() === expectedCollection`
    (This is a cross-check from key → DTO; it is deterministic and does not rely on reversing class name to a collection.)
- For `tmp.*` keys:
  - DB persistence must be forbidden (DbWriter hard-fails if asked to persist a `tmp.*` DTO).
- For `api.*` keys:
  - Direct DB persistence is discouraged and may be forbidden; typical flow is transform → `db.*` or `tmp.*`.

If any validation fails, the service MUST fail fast at boot with an actionable message:

- the key
- the expected class name
- the actual class name
- and, for `db.*`, the expected collection name

## Consequences

Positive:

- One canonical DTO identity (key) across NV.
- File name, registry key, and class name alignment eliminates naming drift.
- Db routing is deterministic and safe (derived from key, not guesses).
- Registry becomes a true choke point that can enforce ADR-0102 and naming invariants.
- Cross-service DTO usage becomes trivial (no per-service registries).

Tradeoffs:

- Renames are more “expensive” (key, file, and class must move together).
- Centralized registration requires discipline and good failure messages when a DTO isn’t registered.
- The scheme is strict by design; exceptions are intentionally not supported.

## Implementation Notes

- Keys are canonical; all callers (controllers/handlers/pipelines/services) pass the key string to `registry.create(...)`.
- Registry keys match DTO filenames (minus `.ts`) to maximize grep-ability.
- Class name enforcement happens in the Registry; TypeScript cannot enforce it alone.
- DB collection routing must come from key segment #2 or Registry metadata derived from it.
- If/when `dbCollectionName()` is removed from DTOs, the Registry remains the single source of truth for collection routing.

## Alternatives Considered

1. Per-service registries with local keys.
   Rejected — DTO usage is cross-cutting; ownership boundaries are not stable.

2. Arbitrary class names with only key enforcement.
   Rejected — invites drift and “brain drain” during refactors.

3. Deriving collection names from class names.
   Rejected — not deterministic and encourages fragile coupling.

4. Manifests / auto-discovery for registration.
   Rejected — unnecessary magic; explicit registration is preferred.

## References

- ADR-0102 (Registry sole DTO creation authority + \_id minting rules)
- ADR-0057 (ID Generation & Validation — UUIDv4; immutable)
- ADR-0040 (DTO-Only Persistence)
- ADR-0047 (DtoBag semantics)
- ADR-0050 (Wire Bag Envelope)
