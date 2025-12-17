adr0077-test-runner-single-orchestrator-handler

# Context

The existing test-runner implementation uses a multi-handler pipeline that mirrors normal NV request pipelines. This structure introduced ambiguity, hidden control flow, and repeated drift around mocking, S2S behavior, DB_STATE safety, and handler-level test execution.

As the number of handlers and tests increases, debugging and determinism become increasingly difficult. The system requires a clearer separation between:
- NV pipeline shape (routing, controller, handler entry)
- Test orchestration logic
- Test persistence and auditability
- Rail failures vs test expectation failures

The test-runner must remain an NV service, but its execution model must be simplified and made explicit.

# Decision

The test-runner service will use a **single orchestrator handler** executed from a standard NV controller + pipeline shell.

The pipeline exists only to preserve NV structural consistency. All test execution logic is owned by the orchestrator handler, which coordinates a small set of explicit collaborators.

## Key Decisions

1. The pipeline index.ts returns exactly one handler: the Test Orchestrator.
2. The orchestrator executes the entire test-run deterministically using explicit loops.
3. Each design responsibility is implemented as a separate TS class, invoked by the orchestrator.
4. Handler-level tests are opt-in via `hasTest()`.
5. Once a handler opts in, a test record is always started and always finalized.
6. Rail errors (throws, unexpected failures) are recorded separately from test failures.
7. Test-runner never writes Mongo directly; persistence is done via S2S calls to test-log.

# Orchestration Components

## TestRunWriter
- Records test-run lifecycle:
  - Started
  - FailedGuard
  - CompletedWithRailErrors
  - CompletedWithFailedTests
  - CompletedGreen
- Records start/end time and aggregate counts.
- Writes via S2S to test-log.

## Guard
- Validates DB_STATE, DB_MOCKS, and S2S_MOCKS.
- On failure:
  - Finalizes the TestRun as FailedGuard.
  - Halts execution immediately.

## TreeWalker
- Produces pipeline index.ts paths to test.
- V1: single hard-coded path.
- V2: full backend discovery.

## IndexIterator
- Outer loop of the test-run.
- For each index file:
  - Creates a fresh HandlerContext.
  - Instantiates a fresh ControllerJsonBase-derived controller.
  - Loads the pipeline index and resolves steps via getSteps().

## runStep() Gate
- Executed after `hasTest()` and after the TestHandler record is started.
- If runStep() returns undefined:
  - This is a test error.
  - The handler-test record is finalized immediately.
  - Execution continues to the next step.

## runTest()
- Executed only if runStep() succeeds.
- Wrapped in try/catch.
- Throws are classified as RailErrors.

# Consequences

## Positive
- Deterministic execution order.
- Clear separation between orchestration and testing logic.
- No hidden pipeline behavior.
- Explicit lifecycle records for both test-runs and handler-tests.
- Stronger forensic guarantees (Started without terminal status == internal failure).

## Trade-offs
- Test-runner diverges structurally from normal request pipelines.
- Requires explicit orchestration code instead of reuse of runPipeline().
- Slightly more boilerplate, significantly more clarity.

# Implementation Notes

- The orchestrator handler must remain thin and procedural.
- All collaborators must be small, single-purpose classes.
- Fresh HandlerContext and Controller instances are required per pipeline index.
- Test-runner must treat rail failures as first-class outcomes.
- The design of runTest() contracts is defined in a separate ADR.

# Alternatives Considered

1. Reusing runPipeline() with test hooks  
   Rejected due to hidden control flow and repeated drift.

2. Fully mocked unit tests only  
   Rejected; safe integration testing is required and enabled by DB_STATE.

3. Per-handler pipelines  
   Rejected due to complexity and duplication.

# References

- ADR-0073 (Handler-Level Test Runner Service)
- ADR-0072 (Triple-Mock Safety Model)
- LDD-35 (Test Runner Architecture)
