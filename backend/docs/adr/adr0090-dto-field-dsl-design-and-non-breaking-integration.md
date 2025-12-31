adr0090-dto-field-dsl-design-and-non-breaking-integration

## Status
Draft / Proposed

## Context
NV DTOs are the canonical truth for wire contracts, persistence shape, and validation. Multiple consumers (tests, UI scaffolding, docs/tools) also need per-field metadata. TypeScript type declarations do not exist at runtime, so metadata must be expressed in runtime values.

ADR-0089 established the direction: a small DTO field-definition DSL that co-locates metadata with field definitions, while keeping canonical DTO JSON unchanged and optionally exposing metadata via a meta envelope.

This ADR specifies the *design details* of the DSL and how it integrates into existing DTOs **without breaking**:
- persistence
- S2S behavior
- existing `toBody()` / `fromBody()` expectations
- DTO validation ownership

Tooling that consumes the DSL (sidecar generation, uniquify/mutation behavior, outputs) is covered in ADR-0091.

## Decision
Introduce a minimal runtime **Field Definition DSL** that DTOs may optionally use to define fields and attach metadata, while guaranteeing:
- canonical DTO JSON remains unchanged
- metadata is never persisted or forwarded accidentally
- existing DTO APIs can remain stable
- adoption can be incremental per DTO (no flag day)

### 1) Field descriptor model
Each DTO defines a single exported `Fields` constant composed of field descriptors:

```ts
export const UserFields = {
  email: field.string({ required: true, unique: true, minLen: 5, maxLen: 200 }),
  phone: field.string({ required: false, unique: true }),
  givenName: field.string({ required: true, alpha: true, case: "capitalized", minLen: 1, maxLen: 80 }),
} as const;
```

A field descriptor is a plain, JSON-like object (no closures required for interpretation) with this conceptual shape:

- `kind`: `"string" | "number" | "boolean" | "literal" | "enum" | "array" | "object" | "union"`
- `required`: `boolean` (default: `true` unless explicitly set)
- `constraints`: kind-specific constraint bag (optional)
- `meta`: metadata bag (optional)

**Design rule:** constraints that affect test-data and shaping are first-class keys (not buried in nested objects) for simple tooling.

### 2) DSL surface area (v1)
The DSL surface is intentionally small and closed. v1 includes:

- `field.string(opts)`
- `field.number(opts)`
- `field.boolean(opts)`
- `field.literal(value, opts)`
- `field.enum(values, opts)` (string enums)
- `field.array(of, opts)` (optional in v1; allowed if needed)
- `field.object(shape, opts)` (optional in v1; allowed if needed)
- `field.union(options, opts)` (optional in v1; allowed if needed)
- `field.optional(inner)` (optional helper; if used, it sets `required:false`)

**v1 default:** prefer `{ required: false }` over wrappers unless union/nullable forces a wrapper.

### 3) Metadata keys (v1)
The DSL must serve tests first and UI second.

#### Test-oriented keys
- `required: boolean`
- `unique?: boolean` (default false)
- `minLen?: number`
- `maxLen?: number`
- `min?: number`
- `max?: number`
- `alpha?: boolean` (letters only: `A–Z` and `a–z`)
- `case?: "lower" | "upper" | "capitalized"` (optional; applies only when `alpha:true` for v1)
- `presentByDefault?: boolean` (default true; controls whether optional fields appear in “happy” generation)

**Definition:** `unique:true` means “should be mutated at test-time to avoid DB duplicates,” not “provably unique against a DB at build time.”

#### UI-oriented keys (optional)
- `ui?: { labelKey?: string; hintKey?: string; placeholderKey?: string; input?: string }`

UI metadata uses **prompt keys**, not localized strings.

### 4) Canonical DTO JSON remains unchanged
The DSL **does not** change canonical DTO JSON. It does not add properties to the DTO instances, and it does not add `meta` fields to persisted/wire JSON.

- `toBody()` returns **data only** (canonical DTO JSON)
- `toBodyWithMeta()` (optional) may return `{ data, meta }` (meta envelope)

#### Meta envelope contract (optional)
If exposed, meta envelope must follow:

```json
{
  "data": { "...canonical dto json..." },
  "meta": { "fields": { "...per-field metadata..." } }
}
```

**Non-breaking guarantee:** existing callers that only use `toBody()` / `fromBody()` continue to work.

### 5) Inbound handling (non-breaking)
DTO edges must tolerate inbound payloads that include the meta envelope without breaking existing behavior.

- If inbound body is `{ data, meta }`, DTO parsing uses `data` and ignores `meta`.
- If inbound body is plain canonical JSON, DTO parsing uses it as-is.

**Rule:** “ignore meta” is an edge concern (controller/fromBody layer), not a handler concern.

### 6) Validation ownership remains in DTO logic
The DSL is **not** the validator and does not replace DTO validation. DTOs remain responsible for:
- `fromBody()` / `fromJson()` parsing rules
- validation and error reporting

The DSL supplies *metadata and hints*, not authoritative validation behavior.

### 7) Incremental adoption and compatibility
DTOs can adopt the DSL incrementally:

- A DTO may export `Fields` and still keep existing explicit properties / Zod schema / `fromJson()` logic unchanged.
- Tools and UI can check for `Fields` presence; absence means “no metadata available.”

No DTO is forced to adopt the DSL. Existing DTOs continue to function unchanged.

## Consequences

### Positive
- Metadata stays co-located with field definitions.
- Runtime tooling (tests, UI scaffolding, docs) can reliably inspect field intent.
- Canonical DTO JSON remains clean and persistence/S2S safe.
- Adoption is incremental, avoiding churn across hundreds of DTOs.

### Negative / Risks
- Some validation constraints may be duplicated (DTO validation + DSL constraints). This is acceptable in v1 because DSL constraints are “tooling hints,” not authoritative.
- Overgrowth risk: DSL can become a schema system if not kept tight. v1 must remain small.

## Implementation Notes (non-tooling)
- Field descriptors must be serializable-ish objects (no closures required to read them).
- Descriptor objects must be `as const` friendly to allow TypeScript inference downstream.
- Keep naming stable; avoid “cute” abbreviations that make tools brittle.
- Avoid ASCII ranges like `A-z`. Use explicit alpha logic (`A–Z`, `a–z`).

## Alternatives Considered
- Separate metadata manifests per DTO (high drift risk).
- UI-only schemas (splits truth away from DTO).
- Decorators / TS emit metadata (heavier, less explicit, and harder to keep stable).
- Full schema system replacing DTO validation (explicitly out of scope).

## References
- ADR-0089: DTO Field DSL with Meta Envelope (umbrella direction)
