adr0094-test-scenario-error-handling-and-logging

# ADR-0094: Test Scenario Error Handling and Logging

## Context

Over multiple iterations, the existing handler test-runner architecture accumulated distributed flags and implicit signaling to express whether errors were expected during test execution (e.g. `expectErrors` in ctx, ALS requestScope flags, log downgrades in helpers, runner heuristics).

This led to:
- Non-deterministic behavior across async boundaries
- Log noise (ERROR/WARN spam) even for expected-negative scenarios
- Difficulty reasoning about correctness, because intent and outcome were inferred instead of explicit
- Tight coupling between test semantics and production error/logging rails

After prolonged debugging, it became clear the design was **too complex and too indirect**. The system attempted to propagate *intent* instead of modeling *state*.

A simpler, explicit, inside-out model is required.

## Decision

Introduce a **single canonical object** to represent test-scenario error state and outcome:

**`TestScenarioStatus`**

This object is:
- Seeded once at the beginning of each test scenario
- The *only* artifact passed around to describe test error intent and outcome
- The sole authority used by the runner to decide logging, continuation, or abort

No other flags (`expectErrors`, ALS fallbacks, ctx bridges, etc.) are permitted for test semantics.

## TestScenarioStatus Model

Each scenario execution produces exactly one `TestScenarioStatus` with one of **five outcomes**:

1. **Passed** — no error caught, success expected (green)
2. **Passed** — no error caught, failure expected (green)
3. **Failed** — no error caught, failure not expected (red, INFO)
4. **Passed** — caught expected error (green)
5. **Failed** — caught unexpected error (red, ERROR, abort pipeline)

The object records:
- Scenario identity (id, name)
- Seeded expectation (what error modes are acceptable)
- Whether an error was caught
- Whether the error was expected
- Whether the error was a rails error or a test/runner error
- Captured error context or explanatory text

## Scenario Structure (Required Pattern)

Each test scenario follows a strict structure:

- **Outer try/catch/finally**
  - Protects runner integrity
  - Any error here is treated as outcome **5** (unexpected runner/test bug)

- **Inner try/catch/finally**
  - Wraps only the test execution (handler invocation)
  - Inner catch captures the thrown error but does not decide outcome

- **Shared finalize helper**
  - Runs in both inner and outer finally blocks
  - Computes the final outcome based on:
    - Seeded expectation
    - Whether an error was caught
    - Rails snapshot (handlerStatus, HTTP status, etc.)
    - Assertion results

Outcome classification is **pure and deterministic**.

## Runner Responsibilities

Each scenario returns a `TestScenarioStatus`.

The ScenarioRunner then:

1. Appends the status to `HandlerTestDto.scenarios`
2. If outcome == 3 → log **INFO**, continue
3. If outcome <= 4 → continue
4. If outcome == 5 → log **ERROR** and abort the pipeline immediately

After all scenarios complete (or abort), StepIterator persists the `HandlerTestDto`.

## Logging Policy

- **ERROR logs are reserved for outcome 5 only** (critical runner/test failures)
- Expected-negative behavior never emits ERROR or WARN
- All other failures are logged at INFO

This guarantees that any ERROR in test-runner logs signals a true infrastructure or harness defect.

## Edge Logic: noLog Flag

To prevent production edge logic from logging expected-negative errors:

- Introduce a single external flag: **`noLog`** (default: false)
- When `noLog=true`:
  - Edge logic must not log
  - Must capture error context
  - Must throw so the scenario can classify the outcome

Propagation:
- S2S calls: `x-nv-no-log: true` header
- MOS services: inbound controller seeds this into request scope so it propagates to downstream S2S calls

This cleanly separates **test semantics** from **production behavior**.

## Consequences

### Positive
- Single source of truth for test outcomes
- Deterministic behavior
- Massive reduction in logging noise
- Easier reasoning and debugging
- Clear abort semantics

### Negative
- Structural refactor required in test-runner and handler tests
- Edge logic must be updated to honor `noLog`

This is acceptable and intentional.

## Implementation Plan (Inside-Out)

1. Create `TestScenarioStatus` class (shared)
2. Create shared finalize helper
3. Retrofit auth pipeline handler tests
4. Update ScenarioRunner to consume `TestScenarioStatus`
5. Update StepIterator persistence
6. Introduce `noLog` support in SvcClient and DB writers

## Status

**Accepted. Locked.**
