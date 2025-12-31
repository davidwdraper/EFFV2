# adr0089-dto-field-dsl-with-meta-envelope

## Status
Draft / Work-in-Progress

## Context
As NowVibin (NV) services mature, DTOs have become the canonical truth for:
- wire contracts
- persistence
- validation
- service-to-service communication

At the same time, multiple consumers (tests, UI rendering, documentation, tooling) need **additional per-field metadata** such as:
- deterministic test-data roles
- UI prompt keys for multilingual rendering
- input hints and capture semantics

Historically, this metadata tends to drift when maintained in:
- separate manifests
- UI-only schemas
- test-only fixtures

The goal is to **co-locate field metadata with the DTO field definition itself**, so that:
- developers cannot easily forget to update it
- tools can consume it at runtime
- persistence and S2S behavior remain unchanged

## Problem Statement
TypeScript `type` declarations do not exist at runtime, which prevents attaching runtime metadata directly to declarations like:

```ts
givenName: string;
```

We need a mechanism that:
- keeps field definition and metadata side-by-side in source code
- exists at runtime
- does NOT pollute canonical DTO JSON
- allows metadata to be optionally returned to callers (e.g., UI)
- guarantees metadata is never persisted or forwarded accidentally

## Proposed Direction (Exploratory)
Introduce a **small, tight Field Definition DSL** used by DTOs as a single source of truth.

Each DTO defines its fields once, using runtime field descriptors that include both:
- the data kind (string, number, literal, enum, etc.)
- lightweight metadata (test roles, UI prompt keys, constraints)

Example (illustrative):

```ts
export const AuthFields = {
  type: field.literal("auth", { required: false }),
  givenName: field.string({
    required: true,
    tdataRole: "humanName",
    ui: {
      labelKey: "auth.givenName.label",
      hintKey: "auth.givenName.hint",
      placeholderKey: "auth.givenName.placeholder",
      input: "text",
    },
    minLen: 1,
    maxLen: 80,
  }),
  lastName: field.string({
    required: true,
    tdataRole: "humanName",
    ui: {
      labelKey: "auth.lastName.label",
      hintKey: "auth.lastName.hint",
      placeholderKey: "auth.lastName.placeholder",
      input: "text",
    },
    minLen: 1,
    maxLen: 80,
  }),
  email: field.string({
    required: true,
    tdataRole: "email",
    ui: {
      labelKey: "auth.email.label",
      hintKey: "auth.email.hint",
      placeholderKey: "auth.email.placeholder",
      input: "email",
    },
  }),
} as const;
```

From this single structure:
- the DTO JSON type is **derived** (no duplication)
- a runtime field-meta map is **derived**
- test-data generators and UI tooling can consume metadata deterministically

## Meta Envelope (Wire Safety)
Field metadata is **never mixed into canonical DTO JSON**.

Instead, DTOs may optionally expose metadata via a **meta envelope**:

```json
{
  "data": { "...canonical dto json..." },
  "meta": {
    "fields": { "...field metadata..." }
  }
}
```

Rules:
- `toBody()` → returns **data only**
- `toBodyWithMeta()` (or equivalent) → returns `{ data, meta }`
- DbWriter and S2S paths **must only use data**
- Meta is opt-in and consumer-driven (UI, tools)

## UI Interaction Model
- UI receives `{ data, meta }`
- Meta contains **prompt keys**, not localized strings
- Server-side rendering expands prompt keys → localized text
- When sending data back to the backend, UI strips meta:
  - `{ data, meta }` → `data`

Backend must:
- ignore or safely unwrap inbound meta if present
- never persist meta

## Non-Goals
- This is NOT a full schema system
- This does NOT move validation rules out of DTO logic
- This does NOT define UI layout, ordering, or presentation
- Metadata is advisory, not authoritative

## Benefits
- Eliminates drift between DTOs, tests, and UI hints
- Keeps DTOs as the single point of truth
- Enables deterministic test-data generation
- Enables UI scaffolding without hard-coded field hints
- Preserves strict separation of domain data vs. meta

## Open Questions
- Exact DSL surface area (`string`, `number`, `literal`, `enum`, etc.)
- Where derived helpers live (shared vs per-service)
- How strictly inbound meta should be rejected vs ignored
- CI rules (e.g., enforce meta presence for certain DTOs in test mode)

## Next Steps
- Keep ADR in draft while experimenting with 1–2 DTOs
- Validate ergonomics with auth + user DTOs
- Decide whether to standardize DSL in shared or keep service-local initially
