<!-- backend/docs/Build-a-test-guide.md -->

# Build-a-test-guide

## 1. Purpose

This guide locks in **how to build handler-level tests** for the test-runner service so that:

- The test-runner can **discover** tests without special wiring.
- ScenarioRunner can **run scenarios** and write results into `HandlerTestDto` with **no per-test debugging**.
- Every handler test follows the **same, predictable pattern** (one scenario per `HandlerTestBase` subclass).

This is the contract the code now relies on.

---

## 2. Big Picture: Who Talks to Whom

There are three main pieces:

1. **Handler** (in a service, e.g., `auth`)

   - Derives from `HandlerBase`.
   - Opts into testing via `hasTest()`.
   - Provides a **stable handler name** used for discovery.

2. **Test module** (sibling file to the handler)

   - File name: `<handlerName>.test.ts`.
   - One or more classes extending `HandlerTestBase`, **one per scenario**.
   - Exports a single `getScenarios()` function that returns an array of **scenario descriptors**.

3. **Test-runner service**
   - Uses the pipeline index + handler name to locate the test module.
   - Calls `getScenarios()` to get the list of scenarios.
   - Calls each `scenario.run()` and records results on `HandlerTestDto.scenarios[]`.

When all three follow this guide, tests “just work”.

---

## 3. Handler Requirements

Every testable handler must follow these rules.

### 3.1 File location

Handler lives in a pipeline folder, for example:

```text
backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/toBag.user.ts
```
