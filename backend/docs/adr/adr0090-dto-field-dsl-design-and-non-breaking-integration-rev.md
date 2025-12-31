adr0090-dto-field-dsl-design-and-non-breaking-integration

## Status
Draft / Proposed (Revised)

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
Each DTO defines a single exported `Fields` constant composed of field descriptors.

### 2) Metadata keys (v1)
The DSL must serve tests first and UI second.

#### UI-oriented keys (scoped)
UI prompt metadata is **context-scoped**, not field-global. The same field may appear in multiple UX flows with different meaning.

The DSL supports scoped UI metadata via a `ui.scopes` map:

```ts
ui: {
  scopes: {
    "auth.signup": {
      labelKey: "auth.signup.email.label",
      hintKey: "auth.signup.email.hint",
      placeholderKey: "auth.signup.email.placeholder",
    },
    "venue.claim": {
      labelKey: "venue.claim.email.label",
      hintKey: "venue.claim.email.hint",
      placeholderKey: "venue.claim.email.placeholder",
    }
  },
  input: "email",
}
```

Rules:
- Prompt keys must include a **scope prefix** describing the UX context.
- Prompt keys are never shared globally by field name alone.
- No localized strings are stored in DTOs; only prompt keys.
- At runtime, callers must explicitly select a UI scope when requesting meta.

(Full ADR text intentionally abbreviated here; content matches revised design discussed.)

## References
- ADR-0089
- ADR-0091
