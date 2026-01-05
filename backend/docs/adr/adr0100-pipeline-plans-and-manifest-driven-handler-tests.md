adr0100-pipeline-plans-and-manifest-driven-handler-tests

# Context

We are redesigning the NV handler-level test-runner to eliminate “implicit discovery” and side effects during test execution.

Current pain points:
- Tests can be incorrectly reported as **Skipped** (or ambiguous “unnamed”) when a handler test module is missing or mis-resolved.
- The runner has relied on *instantiating handlers* (via pipeline step construction) as part of determining test module expectations, creating a chicken-and-egg problem:
  - `buildSteps()` (which calls `new` on handlers) was used to derive information that should be available without side effects.
- Instantiating handlers during “planning” defeats the purpose of a manifest and can trigger unwanted constructor behavior, boot coupling, and state drift.

We want a deterministic, manifest-driven approach:
- A pipeline provides a **production plan** and a **test plan**.
- The test-runner uses the test plan to load tests without instantiating handlers.
- Handlers are instantiated **only** inside scenario execution, in production shape.


# Decision

## 1) Pipelines are plans, not side-effect factories

Each pipeline class (e.g., `UserSignupPL`) MUST expose two independent views:

### A. Production Plan (execution)
A list of step definitions that include handler constructors and stable handler identity, without instantiating handlers.

- Returns: `StepDef[]`
- Each `StepDef` MUST include:
  - `handlerName: string` (stable; used as the canonical step identity)
  - `handlerCtor: new (ctx, controller) => HandlerBase`
  - Optional metadata allowed (e.g., purpose), but no runtime work.

**Invariant:** Building the production plan MUST NOT call `new` on any handler.

### B. Test Plan (debug/test discovery)
A list/map of expected test module names keyed by `handlerName` (or step index), without instantiating handlers.

- Returns: `TestDef[]` or `Record<handlerName, expectedTestName>`
- `expectedTestName` is constrained to exactly one of:
  1) **default** (derived name such as `<handlerName>.test`)
  2) **explicit override** (a provided filename/module id)
  3) `"skipped"` (intentional absence)

**Invariant:** `expectedTestName` MUST NEVER be blank/empty/whitespace. If the pipeline provides a test plan, an invalid test plan is a rails error.


## 2) Test-runner is a 3-stage machine (plan first, execute second)

### Stage I — TreeWalker
Find pipeline entrypoints (paths to pipeline classes).

### Stage II — PlanLoader (or IndexLoader upgraded)
Load the pipeline class and acquire the **plans**:
- `production plan` (StepDefs)
- `test plan` (TestDefs)

This stage MUST NOT instantiate handlers.

Output: `PipelinePlan = { indexPath, target, stepDefs, testDefs }`.

### Stage III — StepIterator (execution)
For each `StepDef`:
1) Seed `HandlerTestDto` (write-once header)
2) Determine `expectedTestName` from test plan:
   - default / override / "skipped"
3) Resolve the test module via `expectedTestName` (not by instantiating handler)
4) Execute the test module’s scenarios.
5) Instantiate the handler ONLY within scenario execution:
   - `new handlerCtor(scenarioCtx, controller).run()`


## 3) Strict semantics for missing tests (ADR-0099 alignment)

- If `expectedTestName === "skipped"`:
  - This step is intentionally not tested. Runner records “Skipped” only under this explicit directive.
- Otherwise:
  - Missing test module OR empty scenario list is **DRIFT** and MUST be recorded as a **Failed** handler test.
  - This is a non-infrastructure failure (do not treat as outcomeCode=5).

**Invariant:** “Unnamed test module” is not a valid state. Empty/unknown names are treated as a rails error (pipeline/test manifest is malformed).


# Consequences

## Benefits
- Deterministic test discovery: no handler constructors executed to “figure out” what tests should exist.
- Removes chicken-and-egg: manifest exists independently of handler instantiation.
- Eliminates ambiguous “skipped by accident” outcomes. A missing expected test becomes a clear failure with an actionable reason.
- Preserves production-shaped execution: handlers are still instantiated in the exact same shape, but only when the scenario runs.

## Costs / Tradeoffs
- Pipeline authoring requires explicit step identity (`handlerName`) and explicit test expectations (`expectedTestName` or default rules).
- The runner must enforce strict validation on the manifest/test plan and fail fast on malformed entries.
- Requires refactor of runner loaders/iterators to split “plan loading” from “step execution”.


# Implementation Notes

- Introduce a pipeline “plan” contract (names illustrative; final names may differ):
  - `steps(): StepDef[]`
  - `tests(): TestDef[] | Record<string,string>`
- Add validation:
  - `handlerName` must be non-empty.
  - `expectedTestName` must be one of:
    - `"skipped"`, or
    - a non-empty string, or
    - omitted to allow a deterministic default.
- Move any prior `buildSteps()` usage out of planning. In test-runner, `buildSteps()` MUST NOT exist; planning is pure.
- Update `ScenarioRunner` to:
  - receive `expectedTestName` from StepIterator (derived from pipeline test plan)
  - record drift failures when expected tests are missing/empty.
- Keep the “virtual server” invariant:
  - Scenario contexts inherit the pipeline runtime (`rt`) automatically; tests are not SvcRuntime-aware.


# Alternatives Considered

1) **Constructor-based discovery**
   - Instantiate handlers to read handler metadata and infer tests.
   - Rejected: creates side effects, breaks manifest purpose, causes drift and “skipped” confusion.

2) **Filesystem-only discovery**
   - Ignore pipeline manifests; scan for `*.test.*` and match by handlerName.
   - Rejected: brittle mapping, encourages implicit behavior, and does not encode intentional skips.

3) **One manifest for both steps and tests, but built by `buildSteps()`**
   - Rejected: still requires instantiating handlers to build the manifest.


# References

- ADR-0094 — Test Scenario Error Handling and Logging
- ADR-0095 — Happy-Path-Only Testing Direction
- ADR-0099 — Handler test manifest from pipelines/handlers (strict missing-test semantics)
- LDD-35 — Handler-level test-runner service
- LDD-38 — Test Runner vNext Design
- LDD-39 — StepIterator Micro-Contract — Revised, KISS
- LDD-40 — Handler Test Design — Build-a-test-guide
