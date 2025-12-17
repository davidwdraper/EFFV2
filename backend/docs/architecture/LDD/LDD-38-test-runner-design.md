# LDD-38 — Test Runner vNext Design

## Overview

This document defines the **vNext Test Runner** architecture for NowVibin (NV).
The test-runner is a first-class NV service that executes handler-level tests in a **deterministic**, **opt-in**, and **forensically auditable** manner.

The design intentionally preserves NV’s external shape (route → controller → pipeline) while collapsing internal complexity into a **single orchestrator handler**.

> **Key principle:**  
> The pipeline exists only to preserve NV shape. All orchestration lives inside one handler.

---

## Core Concepts

1. **test-runner is an HTTP service**
   - Invoked via a standard NV route.
   - Follows the canonical flow: request → controller → pipeline.

2. **Controller remains thin**
   - Starts the pipeline like any other NV controller.
   - No orchestration logic lives in the controller.

3. **Pipeline stays NV-shaped**
   - Routes are one-liners.
   - Pipeline index exists, but returns **exactly one handler**.

4. **Singleton Pipeline Step**
   - `getSteps(ctx, controller)` returns **one handler**.
   - That handler is the **Test Orchestrator**.

5. **Explicit orchestration**
   - The orchestrator does **not** call `runPipeline()`.
   - It performs explicit loops using small, single-purpose collaborators.

---

## Design Features

### 1. Test Orchestrator

**Responsibility:**  
A thin TypeScript handler that sequences the entire test run end-to-end.

**Properties**
- No hidden or implicit logic.
- Each responsibility is delegated to a separate class.
- Executes explicit loops (not pipeline rails).
- Acts purely as an orchestrator.

---

### 2. TestRunWriter

**Responsibility:**  
Persist lifecycle state of a test run.

**Write Model**
- **Start:** create TestRun record with `status = Started`
- **End:** update the same record with final status and summary

**Final Status Values**
- `Started`
- `FailedGuard`
- `CompletedWithRailErrors`
- `CompletedWithFailedTests`
- `CompletedGreen`

**Semantics**
- A run left in `Started` without a terminal state indicates a **test-runner internal failure**.
- Such failures must be accompanied by an ERROR log.

**Tracked Fields**
- `startTime`, `endTime`
- `attemptedTests`
- `passedTests`
- `failedTests`
- `railErrors` (count or boolean)

**Persistence**
- test-runner **never writes Mongo directly**
- All persistence is via S2S calls to **test-log**

---

### 3. Guard

**Responsibility:**  
Hard-stop unsafe or invalid test runs.

**Inputs**
- `DB_STATE`
- `DB_MOCKS`
- `S2S_MOCKS`

**Behavior**
- If configuration is invalid:
  - Finalize TestRun with `status = FailedGuard`
  - Stop orchestration immediately
  - No tree walk, no index iteration

This is the **dry wall** that prevents dirty-water ripples.

---

### 4. TreeWalker

**Responsibility:**  
Produce the list of pipeline index files to test.

**Modes**
- **V1 (Hard-coded):**
  - Returns a single known pipeline index.ts path.
- **V2 (Discovery):**
  - Scans the backend and returns all pipeline index.ts paths.

**Output**
- A list of standardized paths (absolute or repo-relative; one format only).

---

### 5. IndexIterator

**Responsibility:**  
The outer execution engine of the test-runner.

This is where real work happens.

---

## IndexIterator Detailed Flow

### Step 1 — Fresh Context + Controller

For each pipeline index:
- Create a **fresh HandlerContext**
- Instantiate a **ControllerJsonBase-derived controller**
- No shared state between pipelines

Each pipeline runs in a clean sandbox.

---

### Step 2 — Load Pipeline Module

- Load the index module for the pipeline path.
- Expect it to export:
  - `createController(app)`
  - `getSteps(ctx, controller)`

---

### Step 3 — Resolve Steps

- Call: `steps = getSteps(ctx, controller)`
- Steps are handler instances in pipeline order.

---

### Step 4 — Iterate Steps and Execute Tests (Revised)

This section replaces the original step-iteration description.

#### 4.1 — hasTest() Gate

For each step:
- Call `step.hasTest()`
- If `false`: skip step
- If `true`: proceed

> **hasTest() is the only opt-in mechanism.**

---

#### 4.2 — TestHandlerWriter: Start Record (Early)

- Immediately record test start.
- Include foreign key to TestRunId.
- Record handler identity metadata:
  - pipeline/index path
  - handler name
  - service slug/version (final schema TBD)

This guarantees **every opted-in test produces a record**.

---

#### 4.3 — runStep() Produces a Test Plan

- Call: `plan = await runStep(ctx, step)`

If `plan === undefined`:
- This is a **test error**
- Finalize handler-test record as failed due to invalid test setup
- Continue to next step
- **Do not call runTest()**

---

#### 4.4 — Execute runTest() with Rail Protection

- Call `step.runTest(plan, …)` inside try/catch

Outcomes:
- **Throw:** RailError
  - Rails broke, not a test failure
  - Finalize handler-test as RailError
- **Return:** Normal test result
  - Pass or Fail based on returned payload

---

#### 4.5 — TestHandlerWriter: Finalize Record

- Persist final test status:
  - Pass
  - Fail
  - RailError
- Store timing and structured details

---

## Run Summary Semantics

After all pipelines and steps:

Compute:
- `attemptedTests`
- `passedTests`
- `failedTests`
- `railErrors`

Set final TestRun status:
- Guard failed → `FailedGuard`
- RailErrors > 0 → `CompletedWithRailErrors`
- FailedTests > 0 → `CompletedWithFailedTests`
- Otherwise → `CompletedGreen`

Always finalize `endTime`.

---

## Invariants

- Pipeline contains **exactly one step**
- Orchestration lives entirely in that handler
- Fresh context + controller per pipeline
- No cross-pipeline contamination
- Tests are strictly opt-in
- RailErrors ≠ test failures
- TestRun is written as `Started` first
- test-runner never writes Mongo directly

---

## Component Boundaries

- **Handler**
  - TestOrchestratorHandler (singleton pipeline step)

- **Writers**
  - TestRunWriter (S2S → test-log)
  - TestHandlerWriter (S2S → test-log)

- **Logic**
  - Guard
  - TreeWalker (V1/V2)
  - IndexIterator
  - IndexLoader (optional helper)

---

## Explicitly Out of Scope

- Internal structure of `runTest()`
- Test case definition, expectations, and assertions

These are defined in a **separate contract document**.
