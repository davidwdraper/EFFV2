# Build-a-test-guide.md

## Purpose

A handler-level test verifies that when a handler runs under full rails with specific inputs, the final outputs match expectations — whether the path is happy or sad. Tests behave like calling clients: they supply inputs, run the handler once, and assert final outputs.

## Philosophy

Tests never inspect internal logic or mid-handler state. They assert only:

- handlerStatus
- HTTP/rails status
- final context fields relevant to handler outputs

Sad paths are expected failures: handlerStatus="error", status=500. Happy paths expect no rails error and correct outputs.

## Components

- Handler: implements execute(), sets handlerStatus, may set ctx fields.
- HandlerTestBase: wraps handler execution, collects rails signals and assertions.
- ScenarioRunner: discovers test modules, executes scenarios, writes HandlerTestDto results.

---

## Test Entry Structure & Wiring (canonical)

Every handler-level test file must expose **two entrypoints**:

1. **Canonical handler test class** – referenced by the handler via `runSingleTest()`.
2. **Scenario registry** – ordered array consumed by ScenarioRunner.

This ensures:

- handler → test coupling is deterministic
- scenario ordering is explicit in one place
- no alias hacks or filename sorting

### 1. Handler wiring (required)

Handlers must explicitly opt into testing and expose the entrypoint used by the harness. Without this wiring, tests will not be discovered or executed.

```ts
public hasTest(): boolean {
  return true;
}

public override async runTest(): Promise<HandlerTestResult | undefined> {
  return this.runSingleTest(CodeXxxTest); // canonical test class
}
```

### 2. Canonical test class

Each handler’s test file must define a single canonical test class, named by convention:

```ts
export class CodeXxxTest extends HandlerTestBase {
  public testId(): string {
    /* stable id */
  }
  public testName(): string {
    /* human-readable name */
  }

  protected expectedError(): boolean {
    return false; // happy-path smoke by default
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx();
    await this.runHandler({ handlerCtor: CodeXxxHandler, ctx });

    // Final assertions only — no mid-handler inspection
    this.assertEq(ctx.get("handlerStatus"), "ok");
    this.assertEq(ctx.get("response.status"), 200);
  }
}
```

Guidelines:

- `CodeXxxTest` is the **primary smoke test** for the handler.
- It may reuse logic from scenario classes (e.g., extend a happy scenario), but its name and existence are stable.
- The handler must reference **only this class** from `runTest()`.

### 3. Scenario registry (for ScenarioRunner)

The same test module must export a `getScenarios()` function that returns an ordered array of scenario descriptors:

```ts
export async function getScenarios() {
  return [
    {
      id: "svc.pipeline.handler.happy",
      name: "Happy path description",
      expectedError: false,
      shortCircuitOnFail: true,
      async run() {
        const t = new CodeXxxTest();
        return await t.run();
      },
    },
    {
      id: "svc.pipeline.handler.sad-case",
      name: "Sad path description",
      expectedError: true,
      shortCircuitOnFail: false,
      async run() {
        const t = new SomeSadScenario();
        return await t.run();
      },
    },
  ];
}
```

Rules:

- `getScenarios()` is the **only place** that defines execution order.
- ScenarioRunner uses `getScenarios()`; it does **not** call the canonical test class directly.
- Handlers do **not** depend on scenario ordering.

### 4. Handler/Test author checklist

- [ ] `handlerName()` is stable and unique
- [ ] `hasTest()` returns `true`
- [ ] `runTest()` calls `this.runSingleTest(CodeXxxTest)`
- [ ] Test file exports `CodeXxxTest`
- [ ] Test file exports `getScenarios()`
- [ ] Canonical test + scenarios live in the same test file

---

## Scenario Pattern

Each scenario is a `HandlerTestBase` subclass:

```ts
export class ScenarioTest extends HandlerTestBase {
  public testId(): string {
    /* unique id */
  }
  public testName(): string {
    /* human-readable */
  }

  protected expectedError(): boolean {
    return true | false;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx();
    await this.runHandler({ handlerCtor, ctx });

    this.assertEq(ctx.get("handlerStatus") /* expected */);
    this.assertEq(ctx.get("response.status") /* expected */);
    // Additional final-state assertions here
  }
}
```

Scenarios should:

- Work with **full rails** (real controller, real HandlerContext).
- Avoid mid-handler peeking; assert only final context state and rails signals.
- Use helper methods from `HandlerTestBase` (`assertEq`, `assertTrue`, etc.).

---

## getScenarios() (summary)

`getScenarios()` returns descriptors that construct and run scenario instances:

```ts
export async function getScenarios() {
  return [
    {
      id,
      name,
      shortCircuitOnFail,
      expectedError,
      async run() {
        const t = new ScenarioTest();
        return await t.run();
      },
    },
  ];
}
```

The test harness uses:

- `id` for persistence and uniqueness
- `name` for human-readable reporting
- `expectedError` to interpret rails status
- `shortCircuitOnFail` to decide whether later scenarios should still run

---

## Inputs

- `ctx` values via `this.makeCtx()` or `ctx.set()`
- Upstream handler outputs mimicked via `ctx.set("some.key", value)`
- Env values read through svcEnv + `getVar()` / `getDbVar()` (never `process.env` directly in tests)
- For env mutation tests, use shared override helpers (e.g., TTL-backed overrides with manual restore) against the real `EnvServiceDto` instance, not global process state.

---

## Outputs Asserted

Scenarios should assert only final, observable rails and context state:

- `ctx.get("handlerStatus")`
- `ctx.get("response.status")` or `ctx.get("status")`
- Presence/absence and correctness of specific ctx output fields relevant to the handler’s contract (e.g., `ctx["jwt.userAuth"]`, `ctx["bag"]`, etc.)

Avoid:

- Asserting on internal private fields
- Asserting on transient, mid-handler state

---

## Happy/Sad Semantics

**Happy path:**

- `handlerStatus !== "error"`
- HTTP status is not 500 (typically 200, 201, etc.)
- Expected ctx outputs are present and valid

**Sad path (expected failure):**

- `handlerStatus === "error"`
- HTTP status is 500 (or other error status defined by the contract)
- Expected outputs are absent or in error shape

Scenarios must set `expectedError()` to match the intended path so the test harness can interpret rails signals correctly.

---

## Failure Injection

Prefer **controlled bad inputs** over monkey-patching:

- For ctx-driven failures:
  - Omit required ctx keys.
  - Provide invalid values (wrong types, malformed strings, etc.).
- For env-driven failures:
  - Use svcEnv-backed helpers to temporarily override specific env keys for the duration of the scenario.
  - Always:
    - Save the original value
    - Apply the bad value
    - Restore the original value in a `finally` block
    - Optionally use a short TTL failsafe in case of hangs

Never:

- Patch handler internals directly.
- Modify `process.env` globally in tests.

---

## Example Scenario Sketch

**Happy KMS mint:**

- Seed ctx with:
  - `signup.userId`
  - `signup.userCreateStatus.ok === true`
  - `signup.userAuthCreateStatus.ok === true`
- Use real env-service configuration for KMS/JWT vars.
- Assertions:
  - No rails error (`handlerStatus !== "error"`)
  - HTTP status is 200
  - `ctx["jwt.userAuth"]` is a non-empty string
  - `ctx["signup.jwt"]` matches `ctx["jwt.userAuth"]`
  - Header and timestamps are present and sane

**Sad missing env:**

- Same ctx setup as happy path.
- Temporarily remove/override `KMS_KEY_ID` (via svcEnv override helper).
- Assertions:
  - `handlerStatus === "error"`
  - HTTP status is 500
  - No JWT fields set on ctx.

**Sad invalid KMS:**

- Same ctx setup as happy path.
- Corrupt `KMS_PROJECT_ID` or similar value so real KMS fails.
- Assertions:

  - `handlerStatus === "error"`
  - HTTP status is 500
  - No JWT fields set on ctx.

  ### DTO-backed S2S tests (no fake bags)

For any handler that works with a DtoBag (e.g., `S2sUserCreateHandler`), tests MUST NOT hand-roll “bag-like” objects or JSON shapes.

Instead, every test follows this pattern:

1. **Create the DTO via its registry**

   - `const dto = new UserDtoRegistry().newUserDto();`
   - Never `new UserDto()` directly and never construct JSON by hand.

2. **Populate fields via DTO setters only**

   - Use setters for all required data:
     - `dto.setGivenName("...")`
     - `dto.setLastName("...")`
     - `dto.setEmail("...")`
   - Use `HandlerTestBase.suffix()` (or equivalent) to keep values unique and avoid dup collisions.

3. **Apply the canonical id via `setIdOnce()` _if_ the real pipeline does**

   - For auth.signup, `signup.userId` is minted upstream.
   - Tests must mirror that:
     - `dto.setIdOnce(signupUserId);`

4. **Build a real `DtoBag<T>` using shared rails**

   - Never synthesize `{ meta, items }` yourself.
   - Always use the shared builder, which uses `dto.toBody()` under the hood:

     ```ts
     const { bag } = BagBuilder.fromDtos([dto], {
       requestId,
       limit: 1,
       total: 1,
       cursor: null,
     });

     ctx.set("bag", bag);
     ```

5. **Handlers/tests never call `getId()` on a DTO that hasn’t had an id applied**

   - If you need the id in tests, either:
     - Use the known `signup.userId` you passed in, or
     - Call `dto.getId()` **only after** `setIdOnce()` or `ensureId()` has been used.
   - A `DTO_ID_MISSING` error means the test or handler violated this contract.

6. **Handler-level tests assert rails + business state, not wire shapes**
   - Assert `handlerStatus` and business markers (`signup.userCreateStatus`, etc.).
   - Do **not** assert raw HTTP status or try to interpret the full wire envelope; that belongs to the rails.
