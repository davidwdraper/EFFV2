adr0078-dto-private-properties-getters-setters

# ADR-0078 — DTO Property Encapsulation & Setter-Enforced Validation

## Context

As the NowVibin (NV) backend matures, DTOs have become the **canonical truth** for:
- wire contracts
- persistence shape
- validation rules
- invariants enforced across services

Historically, some DTOs exposed public mutable properties. While expedient early on, this pattern creates silent mutation paths, weakens invariants, and makes it difficult to reason about correctness in long-lived systems where refactors are intentional and final.

Given NV’s operating principle — *build once, refactor only on proven design flaws, and never casually return* — DTO surfaces must be locked down.

## Decision

**All DTO properties are private.**  
Access and mutation are strictly controlled via **getters and setters only**.

### 1. Property Visibility Rules

- All DTO fields **MUST** be declared `private` (or `protected` where inheritance is explicitly required).
- No DTO may expose publicly writable properties.

### 2. Getter Rules

- Every externally readable field **MUST** have a getter.
- Getters:
  - perform no mutation
  - return normalized, safe values
  - may return `readonly` views (e.g. arrays)

### 3. Setter Rules (Standard)

- All mutation occurs via setters.
- Setters **MUST**:
  - check whether validation is enabled
  - perform **complete and type-appropriate validation** when enabled
  - normalize input (trim strings, coerce numbers safely, etc.)
- Setters **MUST NOT** silently accept invalid data.

### 4. Write-Once Properties

Some DTO properties represent **header or identity state** (e.g. env, service identity, pipeline metadata).

For these fields:

- Only a `setXxxOnce(...)` setter is permitted
- No normal setter may exist
- A write-once setter:
  - allows assignment exactly once
  - throws if called again
  - throws if the DTO has been frozen (if applicable)

This pattern is mandatory for:
- environment identifiers
- service identity
- pipeline / handler identity
- any field whose mutation would invalidate forensic integrity

### 5. Validation Semantics

- Validation is **opt-in**, controlled by the DTO’s validation flag.
- When validation is enabled:
  - all setters must validate
  - validation must be **thorough**, not superficial
  - error messages must be precise and actionable
- When validation is disabled:
  - setters may still normalize
  - they must not perform partial or misleading validation

### 6. Wire Methods (`fromBody` / `toBody`)

- `fromBody()` **MUST** populate DTOs exclusively via setters (including write-once setters).
- `toBody()` **MUST** read DTO state exclusively via getters.
- Direct property access inside these methods is forbidden.

This guarantees:
- identical invariants whether data comes from wire, DB, or internal construction
- no bypass paths around validation or normalization

## Consequences

### Positive

- DTO invariants are enforced universally
- Silent mutation paths are eliminated
- Validation logic lives in one place
- DTOs become stable, long-term contracts

### Negative / Trade-offs

- Slight increase in boilerplate
- Reduced tolerance for quick-and-dirty prototyping (intentional)

## Implementation Notes

- Existing DTOs must be refactored to comply when modified for functional reasons.
- New DTOs **MUST** comply from inception.
- Code review must reject:
  - public DTO fields
  - setters without validation
  - write-once fields with normal setters
  - direct property access in wire methods

## References

- ADR-0040 — DTO-Only Persistence
- ADR-0049 — DTO Registry & Wire Discrimination
- ADR-0053 — Instantiation Discipline via Registry Secret
- LDD-38 — Test Runner vNext Design
- LDD-39 — StepIterator Micro-Contract

---

**Status:** Accepted  
**Effective:** Immediately
