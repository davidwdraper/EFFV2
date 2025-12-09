# adr0073 — Handler-Level Test-Runner Architecture

## Status  
**Accepted**

## Context  
NV's backend architecture is handler‑centric:
- Each route → controller → pipeline → handlers  
- Handlers are small, deterministic units  
- HandlerContext + DtoBag unify IO and execution state  

But until now, no unified testing framework existed that:
- Tests handlers in isolation  
- Ensures pipeline correctness  
- Confirms the global rails (envBootstrap, controllers, logging) behave identically in all environments  
- Can safely run in production using mock rails  
- Tests itself (meta-testing)  

LDD‑35 formally introduced a test-runner service designed to solve this.

---

## Decision  
We create a dedicated NV microservice: **test-runner**  
- Cloned from `entity_crud` template  
- MOS, no DB persistence  
- Uses triple-switch mocks (ADR‑0072) to ensure safe execution  
- Can run in:
  - Localtest (CLI)  
  - Dev, staging  
  - Production (pre-launch only, with mocks enabled)  

### Test‑Runner Architecture  
The service executes a pipeline of “testing handlers”:

1. **code.treeWalker**  
   Walks backend folder tree, discovers handlers, returns TestRootDto.

2. **code.pipelineLoader**  
   Dynamically imports controllers, pipelines, and handler classes.

3. **code.handlerTestExecutor**  
   Executes handler testScenarios() and validates them.

4. **code.summarizer**  
   Produces TestSuiteSummaryDto.

The system tests each handler using data defined *in the same file*:
- `testScenarios()`  
- `validateTests()`  

This keeps testing logic close to execution logic and avoids drift.

### Self-Test Invariant  
Since the test-runner itself uses handlers, it must test itself.  
This meta-testing is intentional and required:
- Proves the framework is correct  
- Prevents silent rot  
- Ensures tests for all other services remain trustworthy  

---

## Justification  

### 1. Handler-level deterministic testing  
Handlers are the smallest reliable, testable unit.  
Testing them eliminates pipeline noise and external variability.  

### 2. Fast debugging  
Failures show:
- Which handler failed  
- Which scenario  
- Input seed  
- Expected vs actual snapshot  

This reduces debugging time dramatically.

### 3. Unified testing across all services  
Every NV service uses controllers + pipelines + handlers.  
This standardization enables:
- Centralized tree walking  
- Shared test harness  
- Consistent quality enforcement  

### 4. Ability to run safely in production  
With ADR‑0072 triple mocks:
- DB writes go to mock DB or in-memory  
- S2S calls become mock calls  
- WAL & audit are inert  

This allows:
- Prod pre‑launch validation  
- Flash-fire diagnostic testing  
- Confidence without risking data corruption  

### 5. Eliminates need for external test suite  
No Jest, Mocha, Vitest, etc.  
Testing lives inside the architecture and is executed by the service itself.

### 6. Improves developer workflow  
New handlers must implement:
- testScenarios  
- validateTests  

This enforces discipline and consistency.

---

## Consequences  

### Positive  
- Predictable, uniform test strategy  
- Rapid troubleshooting  
- Test-runner becomes a diagnostic tool  
- Real-environment testing possible  
- Self-validation of rails

### Negative / Considerations  
- Adds slight burden to handler authors (must write scenarios)  
- Requires careful mocking in production to avoid side effects  
- Tree walker must remain accurate as directory structures evolve  

---

## References  
- **LDD‑35 — Test-Runner Architecture**  
- ADR‑0072 — Mock-switch design for safe testing  
- NV SOP — Handler-first architecture  
