# adr0096-test-sidecar-cloner

## Context

With the adoption of Happy-Path-Only testing (ADR-0095), handler tests become:

- Highly repetitive
- Structurally predictable
- Strongly tied to handler intent and naming

The system already uses a **service cloner** to generate new services from templates.
A similar approach can eliminate most manual test authoring.

At the same time, the handler architecture already encodes _semantic intent_ via naming:

- `code.*`
- `db.*`
- `s2s.*`
- `api.*`
- `bag.*`

This naming system provides enough signal to infer the correct test shape.

## Decision

Introduce a **Test Sidecar Cloner** that auto-generates happy-path handler tests
based on handler type and naming convention.

The cloner will:

- Select the most appropriate test template (“flavor”)
- Substitute domain-specific names
- Generate a complete `*.test.ts` file
- Target a **~90% first-pass success rate**

Tests that fail after cloning will receive one-off human attention.

## Test Flavors

Initial supported flavors:

- **code.\***

  - Pure logic handlers
  - Assert ctx mutations and handlerStatus

- **db.\***

  - Persistence handlers
  - Assert write/read success via DTO identity

- **s2s.\***

  - Outbound service calls
  - Assert success response and bag preservation

- **api.\***

  - Edge-facing handlers
  - Assert HTTP status and response shape

- **bag.\***
  - DTO/bag hydration handlers
  - Assert correct bag population

Each flavor corresponds to a test template.

## Cloner Behavior

The cloner will:

1. Inspect handler file name and path
2. Determine handler flavor
3. Copy the appropriate test template
4. Substitute:
   - DTO names
   - Service names
   - Route/version identifiers
5. Wire the test into the test-runner correctly
6. Generate a single HappyPath scenario

The output is intentionally boring.

## Non-Goals

- The cloner does NOT generate negative-path tests
- The cloner does NOT infer business rules
- The cloner does NOT replace human review

Its purpose is speed, not intelligence.

## Benefits

- Near-zero cost to expand test coverage
- Consistent test structure across services
- Reduced cognitive load for developers
- Encourages strict handler naming discipline
- Makes test coverage scale with codebase growth

## Relationship to Future Testing

Once rails stabilize:

- The same cloner can be extended to generate:
  - negative-path variants
  - multi-scenario modules
  - stress or contract tests

The happy-path cloner is the foundation.

## Status

Accepted. Locked.
