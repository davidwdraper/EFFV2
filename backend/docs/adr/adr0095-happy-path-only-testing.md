# adr0095-happy-path-only-testing

## Context

The handler-level test-runner architecture (ScenarioRunner, StepIterator, virtual server runtime)
was designed to support rich multi-scenario testing, including negative paths, error classification,
and logging posture control.

In practice, this sophistication significantly slowed test development and refactoring velocity,
especially during active rail cleanup and DTO/wire stabilization.

At this stage of the system’s lifecycle:

- Rails are still evolving
- DTO contracts are still being normalized
- Test infrastructure correctness is more valuable than exhaustive scenario coverage

Negative-path tests have also proven disproportionately expensive:

- They amplify logging noise
- They require downstream services to cooperate with test semantics
- They obscure real integration wiring failures

A decision is required to unblock progress.

## Decision

Adopt a **Happy-Path-Only testing strategy** for the near and medium term.

This means:

1. **All handler tests contain exactly one scenario: `HappyPath`.**
2. Tests focus exclusively on **integration-shaped execution**, not unit isolation.
3. Downstream services are expected to succeed on happy path.
   - If they fail, this is a _real, loggable error_.
4. No negative-path scenarios are authored or maintained at this time.
5. The existing test-runner architecture remains intact and extensible,
   but is used in a minimal configuration.

This is a deliberate trade:

- We favor **speed, signal, and correctness of wiring**
- Over exhaustive scenario validation

## Consequences

### Positive

- Test authoring becomes fast and mechanical
- Tests become declarative boilerplate
- Logging noise is dramatically reduced
- Integration failures surface immediately
- DTO registries become the single source of test data truth
- Handler coverage can expand rapidly

### Negative

- Negative-path behavior is not explicitly tested
- Some error handling regressions may slip through
- Test-runner capabilities are temporarily underutilized

These consequences are accepted and intentional.

## Implementation Rules

- Each `*.test.ts` module defines:
  - One scenario: `HappyPath`
  - One call to `deps.step.execute(ctx)`
- DTOs are **pre-populated via the Registry** (happy DTOs)
- Tests assert only:
  - handlerStatus
  - HTTP status
  - a small number of critical outputs
- No test mutates DTOs to induce failure
- No test asserts on logs

## Future Direction

This decision is explicitly **reversible**.

The test-runner remains capable of:

- Multi-scenario execution
- Negative-path classification
- Advanced posture controls

These features will be reactivated **after rails stabilize**, using automated tooling
to avoid manual test authoring overhead (see ADR-0096).

## Status

Accepted. Locked.
