# LDD-35 — Test-Runner Architecture (Handler-Self-Test System)

## Purpose
Define the architecture for NowVibin’s **test-runner service**, a dedicated MOS-style microservice responsible for running automated, deterministic handler-level tests across the entire backend.

## Overview
The test-runner acts as a *meta-service*:
- It **discovers controllers, pipelines, and handlers** by walking the backend folder tree.
- It loads each handler class.
- It invokes each handler’s built‑in test logic:
  - `testScenarios()` – returns test inputs and expected outcomes.
  - `validateTests()` – validates output snapshots.
- It aggregates results into a suite summary.

The test-runner ultimately **self‑tests itself**, since its handlers also implement the same pattern.

---

## Architectural Components

### 1. Test-Runner Service (MOS)
The test-runner is structured like every other NV service:
- `/src/app.ts`
- `/src/routes/test-runner.route.ts`
- `/src/controllers/test-runner.controller.ts`
- `/src/controllers/.../pipelines/...`
- Handlers under `/handlers/code.*`

This keeps it aligned with NV architecture, enabling consistent:
- Logging  
- SvcEnv  
- Svcconfig  
- Pipeline execution model  
- HandlerContext bus  

---

## 2. Code Tree Walker Handler  
**Responsibility:**  
Discover and enumerate the service → controller → pipeline → handler structure by scanning:

```
backend/services/*/src/controllers/*/*/pipelines/*/index.ts
```

**Output:**  
A **TestRootDto** containing:
- A DtoBag of **TestControllerDto**
  - Each owning a DtoBag of **PipelineDto**
    - Each owning a DtoBag of **HandlerDto**, each containing:
      - handlerName
      - file path
      - import path

The walker does **not** execute tests. It only builds structure.

---

## 3. Pipeline Loader Handler  
**Responsibility:**  
Given the handler tree, dynamically import each handler's class and instantiate it with the controller.  
This mirrors how NV services load controllers today.

**Output:**  
Updates the TestRootDto structure to include:
- Constructor references
- Instantiated handler instances

---

## 4. Handler Test Executor Handler  
**Responsibilities:**
For each handler discovered:
1. Call `testScenarios()` → array of user-defined cases  
2. For each scenario:
   - Spin up a Test HandlerContext  
   - Seed values from the scenario  
   - Call `execute()`  
   - Capture a snapshot  
3. Pass snapshots into `validateTests()`  
4. Record results into a TestResultDto

**Output:**
A TestSuiteSummaryDto containing:
- Per-handler results  
- Aggregated suite pass/fail counts  

---

## 5. Bag-Centric Design
Test data is transported through:
- TestRootDto  
- TestControllerDto  
- PipelineDto  
- HandlerDto  
- TestResultDto  

Each is wrapped in a DtoBag, keeping tests consistent with NV’s core invariants:
- No naked DTOs  
- DTO-only persistence model  
- Bag purity  

---

## 6. Self-Testing the Test-Runner
Since handlers inside test-runner follow the same architectural rules, the suite naturally:
- Tests the walker  
- Tests the loader  
- Tests the executor  
- Tests the summarizer  

This ensures no drift between:
- The test-runner’s own logic  
- The global handler-testing framework  

---

## 7. Invocation paths

### Local Dev & CI
```
pnpm test:handlers
```
Runs the suite in a standalone CLI harness.

### Test-Runner Service Endpoint
```
POST /api/test-runner/v1/run
```
Runs the suite *inside NV*, with triple-mock safety enabled.

### Production Pre-Launch
With triple-switch mocks + prod envLabel:
- Run full suite in real prod environment (using mock DB/S2S)
- Confirms wiring, env bootstrap, controllers, and handler flows are valid before the first real user hits the system.

---

## 8. Benefits
- Deterministic handler tests baked directly into code  
- Architecture enforces test responsibility at the handler level  
- No need for external test files  
- Fast failure identification (per-handler granularity)  
- Self-testing ensures framework correctness  
- Ability to run in prod safely (if mocks enabled)  

---

## 9. Future Extensions
- Golden regression snapshots per handler  
- Coverage reports (handler, pipeline, controller)  
- Benchmark mode (per-handler performance profiling)

---

## Conclusion
LDD‑35 defines a robust testing architecture that:
- Leverages NV rails  
- Scales across all services  
- Tests the smallest reliable unit: **the handler**  
- Operates safely even in production  
- Tests itself  

This is the foundation for ADR‑0073.
