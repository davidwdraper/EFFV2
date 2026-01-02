adr0092-dto-test-data-generation

# ADR-0092 — DTO Test Data Generation (Registry-Owned, Shape-Driven)

## Status

Accepted

## Context

ADR-0088 and ADR-0091 introduced DTO sidecar test data as a way to provide stable,
deterministic happy-path payloads for tests without leaking test logic into DTOs,
controllers, or handlers.

During initial adoption, ambiguity arose around where test data mutation should
occur, especially for:

- fields marked `unique:true` (e.g. email, phone)
- future sad-path variants (missing fields, invalid chars, duplicates)

Early experiments mutated DTO values outside the Registry (in test files or
helpers), which caused drift from DTO validation rules, silent normalization bugs,
and confusion over whether sidecar data was being loaded correctly.

This ADR clarifies ownership, responsibilities, and mechanisms for DTO test data
generation.

## Decision

### 1. The Registry is the sole owner of DTO test data variants

All test DTOs — happy or sad — are minted by the Registry.

Tests must not mutate DTO fields directly, generate ad-hoc unique values, or bypass
Registry minting rules.

Tests express intent only (happy, duplicate, missing, badData). The Registry
guarantees returned DTOs are structurally valid, validated with `validate:true`,
and ready for wire transmission.

### 2. Sidecars remain happy-only

DTO sidecar files (`*.dto.tdata.ts`) remain happy-path only, canonical JSON
(data only, no meta envelope), deterministic and stable.

Example:
UserDtoTdata.getJson() → { givenName: "Abcdef", ... }

Sidecars do not encode scenarios.

### 3. Sidecar hints guide Registry mutation

Sidecar metadata (`getHints()`) describes capabilities, not behavior.

Example:
{
"email": { "unique": true },
"givenName": { "alpha": true }
}

Hints inform the Registry which fields may require mutation and what constraints
must be respected.

### 4. Uniqueness is handled inside the Registry

Fields marked `unique:true` are automatically rewritten by the Registry when
minting test DTOs.

Tests never manage uniqueness.

Two shared primitives are introduced.

uniqueValueBuilder(shape: string): string

- Generates a brand-new, collision-resistant value
- Shape-driven (no seed plumbing)
- Backed by GUID → hash → shape fill

Example shapes:
xxxxxxx@xxx.com
##########
Xxxxxxx

valueMutator(happyValue: string, mutationShape: string): string

- Takes the happy value and reshapes it
- Preserves recognizable structure where possible
- Fills gaps safely when source data runs out

Example:
happyValue = "Abcdef"
shape = "Xxx#xxx"
result = "Abc0def"

### 5. Shape language

The shape language is intentionally minimal.

X = uppercase letter (A–Z)  
x = lowercase letter (a–z)

# = digit (0–9)

other characters are literal passthrough

Examples:
xxx-xxxx  
xxxx@xxx.com  
###-###-####

### 6. Validation is enforced after mutation

Registry minting flow:

1. Load happy JSON from sidecar
2. Apply Registry-owned mutations if required
3. Call Dto.fromBody(..., validate:true)
4. Fail fast on violations

This guarantees no silent normalization, no invalid wire payloads, and no
handler-level surprises.

### 7. Determinism vs uniqueness

This design prioritizes collision avoidance over deterministic replay.

Generated unique values are not required to be reproducible, must be shape-correct
and DTO-valid, and may be logged or captured by tests if needed.

Deterministic replay can be layered later without changing this contract.

## Consequences

Positive:

- Tests remain simple and intention-focused
- DTO validation rules are always respected
- Uniqueness bugs disappear from test code
- Sidecars stay stable and boring
- Registry is the single source of truth

Trade-offs:

- Generated values are not inherently reproducible
- Registry logic becomes slightly more complex
- Requires discipline to prevent external mutation

## Non-Goals

- No scenario generation inside sidecars
- No test-side DTO mutation helpers
- No seed plumbing through handlers or test runner
- No DB-aware uniqueness logic

## References

- ADR-0088 — DTO Test Data Sidecars
- ADR-0090 — DTO Field DSL
- ADR-0091 — DTO Sidecar Tooling & Testdata Output
- NowVibin Backend SOP — DTO-First, Registry-Owned Instantiation
