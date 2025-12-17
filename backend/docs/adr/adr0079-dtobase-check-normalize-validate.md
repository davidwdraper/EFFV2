adr0079-dtobase-check-normalize-validate

# ADR-0079 — DtoBase.check() Normalization + Validation Gate

## Context

NV DTO `fromBody()` implementations have accumulated repetitive, noisy “wire cleanup” code:

- `typeof` checks
- string trimming
- numeric coercion
- optional vs required handling
- per-field validation in ad-hoc blocks

This repetition increases drift risk, reduces readability, and makes it easier for DTOs to diverge in how they normalize and validate inbound data.

ADR-0078 locked DTO encapsulation rules (private fields; setters in / getters out; write-once setters for write-once properties). We now need a **single shared mechanism** for:
- type conversion + normalization
- optional/required handling
- validation (shared + DTO-specific)

…and we need it to integrate cleanly with the ADR-0078 setter model.

## Decision

Introduce a shared helper on `DtoBase`:

- `DtoBase.check(...)`

This function is the **sole DTO-internal gate** for normalization + validation of inbound values.

### Primary Use

- DTO `fromBody()` must call `DtoBase.check()` and then set values via setters (including write-once setters).
- DTO `toBody()` must read values via getters (ADR-0078); it does not use `check()`.

## Signature

`DtoBase.check()` is a generic function with explicit “kind” semantics and optional validator hooks.

```ts
type CheckKind =
  | "string"
  | "stringOpt"
  | "number"
  | "numberOpt"
  | "boolean"
  | "booleanOpt";

type Validator<T> = (value: T) => void; // throws DtoValidationError on failure

type CheckOptions<T> = {
  // When true, validation runs (type + normalization + custom validator).
  // When false/omitted, check() still normalizes but does not enforce custom validation.
  validate?: boolean;

  // Field/path name used for errors (required when validate=true).
  path?: string;

  // Optional, shared or DTO-specific validator.
  validator?: Validator<T>;

  // Optional, additional normalization after base normalization.
  normalize?: (value: T) => T;
};

static check<T>(
  input: unknown,
  kind: CheckKind,
  opts?: CheckOptions<T>
): T;
```

### Return Semantics

- `"string"`: returns `string` (trimmed). If `validate=true`, rejects non-string or empty-after-trim.
- `"stringOpt"`: returns `string | undefined` (trimmed; empty becomes `undefined`).
- `"number"`: accepts `number` or numeric `string`; returns integer via `Math.trunc(n)`. If `validate=true`, rejects invalid/non-finite.
- `"numberOpt"`: returns `number | undefined` (as above), invalid becomes `undefined` unless a validator rejects.
- `"boolean"`: accepts boolean only. If `validate=true`, rejects non-boolean.
- `"booleanOpt"`: returns `boolean | undefined`.

No silent defaulting is permitted. `check()` returns either the normalized value or `undefined` (for `*Opt` kinds), or throws when validation is enabled and input is invalid.

### Error Semantics

When `opts.validate === true` and validation fails, `DtoBase.check()` MUST throw `DtoValidationError`.

- `DtoValidationError` must include:
  - `path` (required; `opts.path`)
  - `code` (e.g., `required`, `invalid_type`, `invalid_format`, `out_of_range`)
  - `message` (actionable)
  - optional structured details

`check()` MUST NOT log.

## Validators

Validators are supplied to `check()` via `opts.validator`.

- Validators may be **shared** or **DTO-specific**.
- Shared validators must live in dedicated TS modules under:

`backend/services/shared/src/dto/validators/`

Examples (non-exhaustive):
- `IdValidators.uuidV4(path)`
- `ContactValidators.email(path)`
- `ContactValidators.phoneE164(path)`
- `StringValidators.oneOf(path, allowed)`
- `NumberValidators.positiveInt(path)`

Validators MUST throw `DtoValidationError` on failure.

## Integration with ADR-0078 (Setters In / Getters Out)

- DTO `fromBody()` uses `DtoBase.check()` for normalization/validation **and** must set values via setters:
  - `setXxx(...)` for normal fields
  - `setXxxOnce(...)` for write-once fields
- Direct property assignment from wire is forbidden.
- DTO `toBody()` reads exclusively via getters; it does not read private fields directly.

## Consequences

### Positive
- DTO wire hydration becomes small and readable.
- Normalization rules become consistent across services.
- Validation becomes composable and centralized.
- Drift risk is reduced by eliminating repeated ad-hoc logic.

### Negative / Trade-offs
- `check()` becomes a core utility that must remain stable.
- DTO authoring requires discipline to always route wire hydration through `check()` + setters.

## Implementation Notes

- Start with the `CheckKind` set above; add kinds only when there is a proven need.
- Prefer shared validators; keep DTO-specific validators small and local.
- Do not add “guessy” coercions (e.g., phone region inference) without an explicit ADR.

## Alternatives Considered

- Keep per-DTO `typeof` blocks: rejected due to readability and drift risk.
- Use external schema libs for all DTOs: rejected; NV DTOs are the canonical contract and already enforce invariants.

## References

- ADR-0078 — DTO Property Encapsulation & Setter-Enforced Validation
- ADR-0040 — DTO-Only Persistence
- ADR-0049 — DTO Registry & Wire Discrimination
