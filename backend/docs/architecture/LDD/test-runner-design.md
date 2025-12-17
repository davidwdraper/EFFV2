Test-Runner vNext Design Spec
Core Concepts

test-runner is an HTTP service

Invoked via a normal NV route: request → controller → pipeline.

controller starts a pipeline like any NV controller

Pipeline stays “NV-shaped” (routes one-liners, controller thin).

pipeline index.ts returns exactly one step

getSteps(ctx, controller) returns a singleton handler.

that single handler is the “Test Orchestrator”

It performs the entire test-run in a deterministic sequence using explicit class collaborators (not rigid pipeline rails).

Design Features

1. Test Orchestrator

Responsibility: One thin TS class (the handler) that executes the run end-to-end by calling small collaborators.

Properties

No “smart” logic hidden in the handler; it just sequences work.

Every “feature” below is a separate TS class file that the orchestrator calls.

It does not re-use runPipeline(); it runs explicit loops.

2. TestRunWriter

Responsibility: Persist test-run lifecycle state.

Write model

On run start: writes a TestRun record with status = Started

On run end: updates with final status and summary counts

Final statuses

Started

FailedGuard

CompletedWithRailErrors

CompletedWithFailedTests

CompletedGreen

Semantics

Started without a terminal status = test-runner internal failure (must be paired with an ERROR log).

Tracks:

startTime, endTime

totals: attempted, passed, failed

railErrors count (or boolean)

Persistence is via S2S call to test-log (test-runner does not write Mongo directly).

3. Guard

Responsibility: Hard-stop unsafe or invalid runs.

Inputs

DB_STATE

DB_MOCKS

S2S_MOCKS

Behavior

If invalid:

TestRunWriter.finalize(status=FailedGuard, …)

Orchestrator stops immediately (no tree walk, no index iteration)

This is the “dry wall” that prevents dirty-water ripples.

4. TreeWalker

Responsibility: Produce the list of pipeline index files to test.

Modes

V1 (hard-coded): returns a single known pipeline index.ts path.

V2 (full discovery): scans backend and returns all pipeline index.ts paths.

TreeWalker returns: string[] of absolute or repo-root-relative paths (pick one and standardize).

5. IndexIterator

Responsibility: Outer loop of the run; executes tests per index file and per handler step.

This is the real engine of the system.

IndexIterator Detailed Flow

For each indexFilePath:

Step 1 — Fresh Context + Controller

Create a fresh HandlerContext

Instantiate a Controller derived from ControllerJsonBase

These are per index file, so every pipeline runs in a clean sandbox.

Step 2 — Load index module

Load the pipeline module for that path.

Expect it to expose the existing function:

getSteps(ctx: HandlerContext, controller: ControllerJsonBase)

Step 3 — Resolve steps

Call: steps = index.getSteps(ctx, controller)

Steps are handler instances, in pipeline order.

Step 4 — Iterate each step and test only those that opt-in

For each step:

4.1 — runStep() replaces runPipeline()

Replace:

await this.runPipeline(ctx, steps)

With:

await this.runStep(ctx, step)

4.2 — hasTest() gate

Call: step.hasTest()

if false: skip and move to next step

if true: proceed

4.3 — TestHandlerWriter: start record

Record test start (foreign key to TestRunId)

Includes identity metadata sufficient to locate the handler under test, e.g.:

pipeline path / index path

handler name

serviceSlug/serviceVersion (target), etc. (exact fields can be finalized later)

Persistence is also S2S to test-log.

4.4 — Execute runTest() with rail protection

Call step.runTest() in try/catch

If runTest() throws:

flag RailError (this is not a “failed test”; it’s “the rails broke”)

record error details in handler-test result

If runTest() returns normally:

treat it as pass/fail according to the returned test result payload (your separate doc defines that contract)

4.5 — TestHandlerWriter: finalize record

Record final test status:

Pass / Fail (normal test outcome)

RailError (exception / unexpected throw)

Store timings, and any structured details returned from runTest().

Run Summary Semantics

At the end of the entire IndexIterator loop, orchestrator computes:

attemptedTests

passedTests

failedTests

railErrors

Then sets final TestRun status:

If guard failed: FailedGuard

Else if railErrors > 0: CompletedWithRailErrors

Else if failedTests > 0: CompletedWithFailedTests

Else: CompletedGreen

Always finalize endTime.

Invariants

Single step pipeline

Pipeline exists only to keep NV shape; orchestration is in the one handler.

Fresh ctx/controller per index

No shared mutation or contamination across pipelines.

Tests are opt-in

hasTest() is the only gate.

RailErrors are distinct from failed tests

Throwing = rails broke, not a test expectation failure.

Writer records Started first

Any crash after that must surface as an ERROR log, leaving Started without terminal status as the forensic clue.

test-runner does not write Mongo

Writes go through test-log via S2S.

Proposed File/Component Boundaries

handler: TestOrchestratorHandler (singleton step in pipeline)

TestRunWriter (S2S to test-log)

TestHandlerWriter (S2S to test-log)

Guard (pure logic + logging)

TreeWalker (V1 and V2 implementations)

IndexIterator (outer loop engine)

IndexLoader (optional helper class if you want a single-purpose module loader)

What’s explicitly out of scope (per your note)

The internal design of runTest() and how a test defines pass/fail inputs/expected outputs is a separate document and should be treated as a separate contract.

Here’s the corrected section (this replaces the “Iterate each step” part in the spec):

Step 4 — Iterate each step and test only those that opt-in (revised)

For each step:

4.1 — hasTest() gate

Call: step.hasTest()

if false: skip and move to next step

if true: proceed

4.2 — TestHandlerWriter: start record (moved earlier)

Immediately record test start (foreign key to TestRunId + handler identity metadata).

4.3 — runStep() executes and returns a “test plan” (gate executed sooner)

Call: plan = await this.runStep(ctx, step)

If plan === undefined:

This is a test error (i.e., the handler opted into testing but did not produce what the test runner needs).

Call TestHandlerWriter.finalize(...) to stamp the record as a test error.

Iterate to the next step (do not call runTest()).

4.4 — Execute runTest() with rail protection

Call step.runTest(plan, …) in try/catch

If runTest() throws:

flag RailError

finalize via TestHandlerWriter with RailError + details

If runTest() returns normally:

finalize via TestHandlerWriter as Pass/Fail based on the returned result payload.

This keeps your truth intact: once hasTest() is true, we always create a handler-test record, and we always finalize it (even if runStep fails early).
