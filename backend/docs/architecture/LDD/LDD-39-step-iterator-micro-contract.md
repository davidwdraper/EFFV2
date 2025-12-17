# LDD-39 — StepIterator Micro-Contract (Revised, KISS)

## Status
**Locked (Revised)**

This document supersedes the previous version of LDD-39.  
All concepts related to "plans" or runner involvement in test logic have been removed.

---

## Purpose

Define the **minimal, stable contract** for `StepIterator` within the test-runner service.

The StepIterator is intentionally **dumb**:
- It does not understand test logic
- It does not prepare test inputs
- It does not coordinate scenarios
- It does not interpret results beyond status classification

Its sole job is to:
1. Decide *whether* a handler participates in testing
2. Invoke the handler’s test
3. Persist the outcome

---

## Core Principle (KISS)

> **Handlers own tests.  
> StepIterator owns orchestration only.**

All test semantics live **inside the handler** and its sidecar test file.

---

## Handler-Level Test Model

Each handler *may* opt into testing.

Example file pairing:
```
code.checkForButterflies.ts
code.checkForButterflies.test.ts
```

- The handler implements:
  - `hasTest(): boolean`
  - `runTest(): Promise<HandlerTestResult | undefined>`
- `runTest()` is responsible for:
  - Instantiating its test class
  - Executing the test
  - Returning a structured result

The StepIterator never imports or references test files.

---

## StepIterator Responsibilities (Exact)

For each handler step in pipeline order:

### 1. hasTest() Gate

```ts
if (!handler.hasTest()) {
  continue;
}
```

- `false` → handler is skipped entirely
- `true` → testing path begins

---

### 2. TestHandlerWriter.start()

Once `hasTest()` is `true`, the StepIterator **must immediately** create a test record.

**Invariant**:
> If `hasTest()` returns true, a handler-test record is always created and always finalized.

Metadata recorded includes (minimum):
- TestRunId (foreign key)
- Pipeline/index path
- Handler name
- Service slug/version (target)

---

### 3. Execute runTest()

```ts
try {
  const result = await handler.runTest();
} catch (err) {
  // RailError
}
```

Execution rules:

#### Case A — runTest() returns a result
- Result is treated as **Pass** or **Fail**
- Semantics are defined entirely by the returned payload

#### Case B — runTest() throws
- This is a **RailError**
- Indicates broken rails, not a test failure
- Stack/error details are recorded

#### Case C — runTest() returns undefined
- This is a **TestError**
- Meaning: handler opted into testing but failed to execute a test
- Recorded distinctly from RailError

---

### 4. TestHandlerWriter.finalize()

Every started test record is finalized exactly once with one of:

- `Passed`
- `Failed`
- `TestError` (undefined result)
- `RailError` (exception)

Durations and structured details are persisted here.

---

## Explicit Non-Responsibilities

StepIterator **must never**:

- Construct or interpret test plans
- Call scenario helpers
- Inspect test internals
- Decide pass/fail semantics
- Perform assertions
- Swallow exceptions

Any such logic belongs inside the handler or its test.

---

## Invariants

- Tests are **opt-in only** (`hasTest()`)
- Handlers own test execution
- Throwing ≠ failed test → it is a RailError
- `undefined` result ≠ skip → it is a TestError
- StepIterator logic must remain small, boring, and stable

---

## Why This Will Not Drift

- The contract is binary and explicit
- There are no extension points to misuse
- New handlers either:
  - implement tests correctly
  - or fail loudly and visibly

This is intentional.

---

## Related Documents

- LDD-38 — Test-Runner Design
- ADR-0077 — Test-Runner Single Orchestrator Handler
- ADR-0073 — Handler-Level Test Execution

