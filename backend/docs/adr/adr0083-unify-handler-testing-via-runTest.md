# adr0083-unify-handler-testing-via-runTest

## Context

The current handler-level testing contract exposes two parallel signals:

- `hasTest(): boolean`
- `runTest(): HandlerTestResult | undefined`

In practice this has led to ambiguity and redundancy:

- A handler may return `hasTest() === true` while `runTest()` returns `undefined`.
- The test-runner must reason about *both* flags to determine whether a handler is testable.
- Returning `undefined` from `runTest()` violates the stated invariant that handler tests produce a concrete, recordable result.

This duplication increases cognitive load, complicates the test-runner, and creates opportunities for inconsistent behavior across handlers.

The system already treats `runTest()` as the canonical execution point for handler tests. Therefore, the additional `hasTest()` signal is unnecessary if `runTest()` has a strict, universally agreed contract.

## Decision

We will **remove `hasTest()` entirely** from the handler testing contract.

`runTest()` becomes the **single authoritative interface** for handler-level tests.

### New `runTest()` contract

- `runTest()` **MUST always return a concrete `HandlerTestResult`**.
- `runTest()` **MUST NEVER return `undefined`**.

Outcomes are interpreted by the test-runner based on the returned result.

### Standard outcomes

The following outcomes are canonical:

- `passed`
- `failed`
- `skipped`

The `skipped` outcome MUST include a clear reason code.

### Required reason codes

- `NO_TEST_PROVIDED`
  - Returned by the base `HandlerBase.runTest()` implementation.
  - Indicates the handler does not opt into testing.
  - Semantically replaces `hasTest() === false`.

- `NO_SCENARIOS_PROVIDED`
  - Returned when a scenario-based test exists but yields zero scenarios.
  - Indicates a test wiring or authoring error.
  - Treated as a failure or loud warning by the test-runner.

## Consequences

### Positive

- Eliminates duplicated signaling (`hasTest()` vs `runTest()`).
- Enforces a single, invariant-based test contract.
- Simplifies test-runner logic.
- Makes test coverage explicit and auditable in persisted test results.
- Prevents silent skipping due to `undefined` returns.

### Negative / Tradeoffs

- This is a breaking change.
- All existing handlers and test helpers must be updated to conform.
- The test-runner must be updated to interpret `skipped` outcomes correctly.

These tradeoffs are acceptable and intentional.

## Implementation Notes

1. Remove `hasTest()` from `HandlerBase` and all handlers.
2. Update `HandlerBase.runTest()` to return:

   - `outcome: "skipped"`
   - reason: `NO_TEST_PROVIDED`

3. Update `runTestFromScenarios()` to return:

   - `outcome: "skipped"`
   - reason: `NO_SCENARIOS_PROVIDED`

   when the scenario factory returns an empty array.

4. Update the test-runner to:
   - Always call `runTest()`.
   - Persist all results, including skipped tests.
   - Treat `NO_SCENARIOS_PROVIDED` as a failure or high-severity warning.

5. Remove all runner logic that inspects `hasTest()`.

## Alternatives Considered

### Keep `hasTest()` and loosen `runTest()`

Rejected.

This preserves ambiguity and allows handlers to lie about testability.

### Return `undefined` from `runTest()` to mean “no test”

Rejected.

This violates invariants, complicates persistence, and forces defensive checks throughout the runner.

## References

- ADR-0041 (Controller & Handler Architecture)
- ADR-0042 (HandlerContext Bus — KISS)
- ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
- Build-a-test-guide.md
