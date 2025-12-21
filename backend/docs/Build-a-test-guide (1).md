# Build-a-test-guide

## 1. Purpose

This guide locks in **how to build handler-level tests** for the test-runner service so that:

- The test-runner can **discover** tests without special wiring.
- `ScenarioRunner` can **run scenarios** and write results into `HandlerTestDto` with **no per-test debugging**.
- Every handler test follows the **same, predictable pattern** (one scenario per `HandlerTestBase` subclass).
- Rails semantics (200 vs 500, handlerStatus, etc.) are **never guessed** by individual tests; they are interpreted once in `HandlerTestBase` + `HandlerTestDto`.

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
   - Each scenario descriptor’s `run()` calls `HandlerTestBase.run()` and returns a `HandlerTestResult`.

3. **Test-runner service**

   - Uses the pipeline index + handler name to locate the test module.
   - Calls `getScenarios()` to get the list of scenarios.
   - For each scenario:
     - Calls `scenario.run()` → `HandlerTestResult`.
     - Wraps that into the DTO’s `runScenario(...)` call.
   - `HandlerTestDto` computes **scenario status** and **final test status** based on:
     - Test outcome (`passed` / `failed`).
     - Whether the scenario is an expected error.
     - Rails verdict (`ok` / `rails_error` / `test_bug`).

When all three follow this guide, tests “just work”.

---

## 3. Handler Requirements

Every testable handler must follow these rules.

### 3.1 File location

Handler lives in a pipeline folder, for example:

```text
backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/toBag.user.ts
```

The test module will live **next to it** (same folder).

### 3.2 hasTest()

Opt-in for the test-runner:

```ts
public override hasTest(): boolean {
  return true;
}
```

If `hasTest()` is `false`, `StepIterator`/`ScenarioRunner` will **skip** this handler entirely.

### 3.3 Handler name → file name

There must be a **stable handler name** that will be written into `HandlerTestDto.handlerName` and used to derive the test module name.

Current pattern (auth example):

```ts
protected override handlerName(): string {
  return "toBag.user"; // handlerName
}
```

**Mapping:**

- Handler name: `"toBag.user"`
- Test module file: `toBag.user.test.ts`
- `HandlerTestDto.handlerName`: `"toBag.user"`

For the `code.build.userId` example:

- Handler name: `"code.build.userId"`
- Test module file: `code.build.userId.test.ts`

Whatever name the handler reports must match the test module’s base file name (before `.test.ts`).

## 4. Test Module Requirements

For every handler that sets `hasTest() === true`, there must be a matching test module:

```text
<handler-folder>/<handlerName>.test.ts
```

Examples:

- Handler: `"code.build.userId"` → `code.build.userId.test.ts`
- Handler: `"toBag.user"` → `toBag.user.test.ts`
- Handler: `"code.passwordHash"` → `code.passwordHash.test.ts`

Each test module must:

1. Export one or more **scenario classes** derived from `HandlerTestBase`.
2. Export an **async `getScenarios()`** function that returns an array of scenario descriptors.
3. (Optionally) export a back-compat alias used by `runSingleTest(...)`.

### 4.1 Scenario classes (HandlerTestBase)

Each **scenario** is its own `HandlerTestBase` subclass.

Common pattern:

```ts
import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import { SomeHandler } from "./some.handler";

export class SomeHandlerHappyTest extends HandlerTestBase {
  public testId(): string {
    return "service.slug.handler.happy";
  }

  public testName(): string {
    return "Human-readable description of the happy path";
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-some-handler-happy",
      dtoType: "some.dtoType",
      op: "some.op",
      body: {
        /* handler-specific test payload */
      },
    });

    await this.runHandler({
      handlerCtor: SomeHandler,
      ctx,
    });

    // Assertions using HandlerTestBase helpers:
    //   this.assertEq(...);
    //   this.assertCtxUUID(ctx, "some.key");
    //   etc.
  }
}
```

**Key points about `HandlerTestBase`:**

- `run()` wraps `execute()` in `withRequestScope`, seeding:
  - `requestId`
  - `testRunId`
  - `expectErrors` (derived from `expectedError()` override)
- `run()` catches any thrown error and returns a `HandlerTestResult`:

  ```ts
  export interface HandlerTestResult {
    testId: string;
    name: string;
    outcome: "passed" | "failed";
    expectedError: boolean;
    assertionCount: number;
    failedAssertions: string[];
    errorMessage?: string;
    durationMs: number;
    railsVerdict?: "ok" | "rails_error" | "test_bug";
    railsStatus?: number;
    railsHandlerStatus?: string;
    railsResponseStatus?: number;
  }
  ```

- `runHandler()`:

  - Instantiates the real handler: `new Handler(ctx, controller)`.
  - Calls `handler.run()` under full rails (no shortcuts).
  - Reads `handlerStatus`, `status`, and `response.status` from `ctx`.
  - Derives `railsError` truth.
  - Enforces:

    - If **no error expected** and rails error is present → **throws** `RAILS_VERDICT: unexpected rails error...`.
    - If **error expected** and rails error is absent → **throws** `RAILS_VERDICT: expected rails error but handler succeeded...`.

  - Records the rails metadata into `lastRails` so `HandlerTestResult` has the correct `railsVerdict`, `railsStatus`, etc.
  - If no rails mismatch is seen, resolves with a `HandlerRunResult` (and `run()` keeps `outcome: "passed"`).

- `suffix()`:

  - Short-lived helper for generating **unique test data** per scenario instance.
  - Implemented on `HandlerTestBase` as a cached 6-character string derived from a timestamp.
  - Usage pattern:

    ```ts
    const suffix = this.suffix();
    const email = `auth.signup+${suffix}@example.com`;
    const name = `AuthUser-${suffix}`;
    ```

  - Rules:
    - Generated once per test instance; returns the **same value** for the lifetime of that instance.
    - Never passed as an argument all over the place; just call `this.suffix()` wherever the test needs a unique value.
    - Used to avoid Mongo duplicate-key collisions on indexed fields like email/name.

Negative tests do **not** do their own rail classification; they only assert on `ctx` values after `runHandler()` returns.

### 4.2 Negative tests (`expectedError()`)

For **“unhappy path”** scenarios where the handler is _supposed_ to rail (500, `handlerStatus: "error"`, etc.), the recommended pattern is:

- Override `expectedError()` on the test class:

  ```ts
  protected expectedError(): boolean {
    return true;
  }
  ```

- Call `runHandler()` **without** passing `expectedError` again:

  ```ts
  await this.runHandler({
    handlerCtor: SomeHandler,
    ctx,
  });
  ```

`HandlerTestBase.runHandler()` uses `input.expectedError ?? this.expectedError()`, so the override is the single source of truth.

Then assert on the rails signals the handler left on the context:

```ts
const handlerStatus = ctx.get<string>("handlerStatus");
const rawResponseStatus = ctx.get<number>("response.status");
const statusCode =
  rawResponseStatus !== undefined
    ? rawResponseStatus
    : ctx.get<number>("status");

this.assertEq(
  String(handlerStatus ?? ""),
  "error",
  "handlerStatus should be 'error' on the expected failure path"
);
this.assertEq(
  String(statusCode ?? ""),
  "500",
  "statusCode should be 500 on the expected failure path"
);
```

This gives you the semantics you wanted:

- **Passed** — scenario behaved as designed (happy _or_ sad path).
- **Failed** — scenario logic failed (assertions or rails mismatch).
- **TestError** — test code itself blew up (see `HandlerTestDto` section below).
- **RailsVerdict** (`ok` / `rails_error` / `test_bug`) — extra rails classification for ops.

### 4.3 `getScenarios()` contract

This is the **critical contract** that the test-runner depends on.

Pattern:

```ts
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";

export async function getScenarios() {
  return [
    {
      id: "auth.signup.code.build.userId.happy",
      name: "auth.signup: CodeBuildUserIdHandler mints UUIDv4 on ctx['signup.userId']",
      shortCircuitOnFail: true,
      expectedError: false,
      async run(): Promise<HandlerTestResult> {
        const test = new CodeBuildUserIdTest();
        return await test.run();
      },
    },
  ];
}
```

Key points:

- `getScenarios()` is `async` and returns an array of **scenario descriptors**.
- Each scenario descriptor has:

  - `id: string` — scenario key (goes into `HandlerTestDto`).
  - `name: string` — human-readable label.
  - `shortCircuitOnFail?: boolean` — if `true`, `ScenarioRunner` stops executing additional scenarios once this one fails.
  - `expectedError: boolean` — for documentation; **the actual enforcement lives in the test’s `expectedError()` and `runHandler()`**.
  - `run: () => Promise<HandlerTestResult>` — ALWAYS calls `new ScenarioTest().run()`.

- `run()` must **not** call `execute()` directly. Always use `run()` so that:
  - `withRequestScope` executes.
  - assertion counting works.
  - `railsVerdict` is captured correctly.

### 4.4 Optional back-compat alias

If a handler still calls `runSingleTest(SomeTest)`, you can provide an alias:

```ts
export { ToBagUserHappyTest as ToBagUserTest };
```

This lets the handler’s legacy `runTest()` keep working while the new `getScenarios()` API powers the test-runner.

### 4.5 `HandlerTestSeed` and `makeCtx()`

All tests call `this.makeCtx(seed)` where `seed` is a `HandlerTestSeed`.

Current `HandlerTestSeed` shape:

- `requestId?: string`
- `dtoType?: string`
- `op?: string`
- `body?: unknown`
- `bag?: unknown`
- `pipeline?: string`
- `slug?: string`
- `headers?: Record<string, string>`

**Rules:**

- If you need another seed field, **add it to `HandlerTestSeed`** in `HandlerTestBase.ts`.  
  Don’t sneak extra properties into the object literal; TypeScript will complain and it breaks the contract.
- If a handler reads from HTTP headers, use the `headers` property:

  ```ts
  const ctx = this.makeCtx({
    requestId: "req-auth-signup-codeExtractPassword-happy",
    dtoType: "user",
    op: "code.extract.password",
    headers: {
      "x-signup-password": "GoodPassw0rd!#", // test input only; never logged
    },
  });
  ```

- To explicitly model “no headers”, still use `headers: {}`:

  ```ts
  const ctx = this.makeCtx({
    requestId: "req-auth-signup-codeExtractPassword-missing",
    dtoType: "user",
    op: "code.extract.password",
    headers: {}, // handler sees an empty bag, not undefined
  });
  ```

`HandlerTestBase.seedDefaults()` maps `HandlerTestSeed` onto `HandlerContext` (`ctx["headers"]`, `ctx["body"]`, etc.), so tests only describe deltas; shared defaults stay centralized.

### 4.6 Use handler injection hooks, not monkey-patching

Some handlers expose **injection hooks** via the context for tests to simulate low-level failures without touching globals. For example, `CodePasswordHashHandler`:

```ts
const injectedFn = this.ctx.get<ScryptFn>("signup.passwordHashFn" as any);
const scryptFn: ScryptFn =
  injectedFn && typeof injectedFn === "function"
    ? injectedFn
    : crypto.scryptSync;
```

**Rules:**

- Use these hooks instead of monkey-patching Node built-ins like `crypto.scryptSync`.  
  Modern Node makes many of these properties non-writable accessors, which causes test bugs like:

  > `Cannot set property scryptSync of #<Object> which has only a getter`

- Example sad-path test for password hashing:

  ```ts
  protected expectedError(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-passwordHash-failure",
      dtoType: "user",
      op: "code.passwordHash",
    });

    ctx.set("signup.passwordClear", "AnotherStrongPass#1");

    ctx.set(
      "signup.passwordHashFn",
      ((password: string, salt: string | Buffer, keylen: number): Buffer => {
        throw new Error("TEST_FORCED_SCRYPT_FAILURE");
      }) as typeof crypto.scryptSync
    );

    await this.runHandler({
      handlerCtor: CodePasswordHashHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    const rawResponseStatus = ctx.get<number>("response.status");
    const statusCode =
      rawResponseStatus !== undefined
        ? rawResponseStatus
        : ctx.get<number>("status");

    this.assertEq(
      String(handlerStatus ?? ""),
      "error",
      "handlerStatus should be 'error' when hashing fails"
    );
    this.assertEq(
      String(statusCode ?? ""),
      "500",
      "status should be 500 when hashing fails"
    );

    const hash = ctx.get("signup.hash");
    this.assert(
      typeof hash === "undefined" || hash === null,
      "signup.hash should not be set on hash failure"
    );
  }
  ```

This keeps the low-level failure inside the handler rails, where `runHandler()` and the DTO can classify it correctly.

### 4.7 DTO-backed tests: short-lived DTOs for inbound JSON shapes

Many handlers accept or produce **DTO-backed payloads** (e.g., `UserDto`, `EnvServiceDto`). For any test that needs to create an inbound JSON shape that ultimately maps to a DTO, follow this pattern:

1. **Use the shared DTO registry**

   - Every DTO type that participates in S2S or edge contracts must be constructible via a shared registry in `@nv/shared` (e.g., `user.dtoRegistry`, `env-service.dtoRegistry`).
   - If a registry currently lives in a service-specific folder, it must be refactored into **shared** before tests depend on it.

2. **Mint a short-lived DTO instance via the registry**

   - Example:

     ```ts
     import { UserDtoRegistry as userRegistry } from "@nv/shared/dto/registry/user.dtoRegistry";

     const dto = new userRegistry().newUserDto();
     ```

   - The DTO instance is **short-lived** and exists only long enough to build the inbound JSON shape for a single test scenario.

3. **Set fields via DTO setters only**

   - Never reach into DTO internals or assign fields on the underlying JSON object.
   - Use the DTO’s public API:

     ```ts
     const suffix = this.suffix();

     dto.setGivenName?.(`AuthS2S-${suffix}`);
     dto.setFamilyName?.(`UserCreate-${suffix}`);
     dto.setEmail?.(`auth.s2s.user.create+${suffix}@example.com`);
     ```

   - This ensures all validation and normalization logic lives in one place: inside the DTO.

4. **Call `dto.toBody()` to obtain JSON**

   - Tests **never** hand-roll JSON objects that represent DTOs.
   - Instead:

     ```ts
     const body = dto.toBody();
     ```

   - The result is the **only** JSON used when constructing bags or HTTP bodies for that DTO type.

5. **Build bags from DTOs, not raw JSON**

   - For bag-based handlers (e.g., S2S calls using `DtoBag<UserDto>`), always build the bag from DTO bodies rather than hand-crafted JSON:

     ```ts
     const bag = {
       meta: { dtoType: "user" },
       items: [
         {
           id: dto.getId?.(), // optional; worker can mint ids on create
           data: body,
         },
       ],
     };
     ```

   - The test can cast to the concrete `DtoBag<UserDto>` type as needed, but the **source of truth** is always the DTO and `toBody()`.

6. **Use `suffix()` for uniqueness**

   - Any DTO field that could collide across test runs (email, phone, username, etc.) must include `this.suffix()` in its value.
   - This prevents Mongo duplicate-key errors from polluting handler tests, especially when tests are re-run frequently or in parallel.

7. **Never touch the final JSON directly in assertions**
   - Tests should assert against:
     - `HandlerContext` values (`ctx.get(...)`),
     - DTO-level getters (if the DTO is still in scope), or
     - High-level status flags (`signup.userCreateStatus`, etc.).
   - They should **not** introspect or mutate the raw JSON produced by `toBody()`; that shape is an implementation detail of the DTO.

This pattern keeps **DTO construction, validation, and shape** in a single place (the DTO + registry) while giving tests a reliable way to generate correct inbound payloads.

---

## 5. HandlerTestDto: Single Source of Truth for Status

`HandlerTestDto` is where **scenario status** and **final test status** are computed. Tests and `ScenarioRunner` do not hand-roll status logic.

### 5.1 Test-level status

Top-level test status (`HandlerTestStatus`) is one of:

- `"Started"` — test record has been seeded but not finalized.
- `"Passed"` — all recorded scenarios passed.
- `"Failed"` — at least one recorded scenario failed.
- `"TestError"` — _no_ scenarios recorded successfully (or all scenarios failed in a “buggy” way).

This maps to the status set you wanted:

- **Passed** — handler behaved as expected (happy or sad path).
- **Failed** — handler behavior didn’t match the scenario’s expectations.
- **TestError** — something went wrong with the test harness itself (scenario blew up, module load failure, etc.).

### 5.2 Scenario status normalization

Each scenario stored in `HandlerTestDto.scenarios[]` has:

- `name: string`
- `status: "Passed" | "Failed"`
- `startedAt`, `finishedAt`, `durationMs`
- `details?: unknown`
- `errorMessage?: string`
- `errorStack?: string`

The important bit is that, for handler tests, `details` is the **full `HandlerTestResult`** returned by `HandlerTestBase.run()`:

```jsonc
"details": {
  "testId": "...",
  "name": "...",
  "outcome": "passed" | "failed",
  "expectedError": true | false,
  "assertionCount": 0,
  "failedAssertions": [],
  "errorMessage": "...",
  "durationMs": 2,
  "railsVerdict": "ok" | "rails_error" | "test_bug",
  "railsStatus": 200 | 500,
  "railsHandlerStatus": "ok" | "error"
}
```

`HandlerTestDto._normalizeScenarioStatus()` applies the rules:

1. **Hard test failures win**:

   - If `outcome === "failed"` → scenario `status = "Failed"`.
   - If `failedAssertions.length > 0` → scenario `status = "Failed"`.

2. If `railsVerdict === "rails_error"`:

   - If `expectedError === true` → scenario `status = "Passed"`.
   - If `expectedError === false` → scenario `status = "Failed"`.

3. If no rails error and no failed assertions:
   - `outcome === "passed"` or `outcome` undefined → scenario `status = "Passed"`.

This avoids the situation where “500 in the rails” looks like a **pass** unless the test explicitly opts into `expectedError`.

### 5.3 Finalizing from scenarios

`HandlerTestDto.finalizeFromScenarios()`:

- Computes `durationMs` from `startedAt` / `finishedAt`.
- Aggregates `scenarios[]` to set `status`:
  - Any scenario with `status === "Failed"` → test `"Failed"`.
  - Else at least one `"Passed"` → test `"Passed"`.
  - Else (no scenarios) → test `"TestError"`.

It also derives **rails metadata** (for ops) from the **first scenario’s** `details`:

- `railsVerdict` (e.g., `"ok"`, `"rails_error"`, `"test_bug"`)
- `railsStatus` (e.g., `200`, `500`)
- `railsHandlerStatus` (e.g., `"ok"`, `"error"`)

These do **not** change the test status; they’re a diagnostic side-channel.

---

## 6. Concrete Examples

### 6.1 Single-scenario handler — `code.build.userId`

**Handler:** `code.build.userId.ts`

- `handlerName(): "code.build.userId"`
- `hasTest(): true`

**Test module:** `code.build.userId.test.ts`

```ts
import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import { CodeBuildUserIdHandler } from "./code.build.userId";

export class CodeBuildUserIdTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.code.build.userId.happy";
  }

  public testName(): string {
    return "auth.signup: CodeBuildUserIdHandler mints UUIDv4 on ctx['signup.userId']";
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-signup-build-user-id",
      dtoType: "auth.signup",
      op: "build.userId",
    });

    await this.runHandler({
      handlerCtor: CodeBuildUserIdHandler,
      ctx,
    });

    this.assertCtxUUID(ctx, "signup.userId");
  }
}

export async function getScenarios() {
  return [
    {
      id: "auth.signup.code.build.userId.happy",
      name: "auth.signup: CodeBuildUserIdHandler mints UUIDv4 on ctx['signup.userId']",
      shortCircuitOnFail: true,
      expectedError: false,
      async run(): Promise<HandlerTestResult> {
        const test = new CodeBuildUserIdTest();
        return await test.run();
      },
    },
  ];
}
```

This is the **canonical single-scenario pattern**.

### 6.2 Multi-scenario handler — `code.passwordHash` (happy + two sad paths)

**Handler:** `code.passwordHash.ts`

- `handlerName(): "code.passwordHash"`
- `hasTest(): true`

**Test module:** `code.passwordHash.test.ts`

Three scenarios:

- Happy path.
- Missing password (precondition error).
- Hash failure (scrypt error).

The key points:

- Each test extends `HandlerTestBase`.
- Negative tests override `expectedError(): true`.
- The hash-failure test uses the **injection hook** `ctx["signup.passwordHashFn"]` instead of monkey-patching `crypto.scryptSync`.
- `getScenarios()` returns descriptors whose `run()` calls each test’s `run()`.

(See your current `code.passwordHash.test.ts` implementation — it now matches this pattern.)

---

## 7. Checklist for New Tests

When you add a new handler test:

### 7.1 Update the handler

- [ ] Ensure `hasTest(): true`.
- [ ] Ensure `handlerName()` (or `getHandlerName()`) returns the intended name.
- [ ] Confirm that `<handlerName>.test.ts` will sit next to the handler file.

### 7.2 Create the test module

For **each scenario**:

- [ ] Create a `HandlerTestBase` subclass.
- [ ] Implement `testId()` and `testName()`.
- [ ] If scenario expects a handler error, override `expectedError(): true`.
- [ ] Implement `execute()` using `makeCtx()` and `runHandler()` (no custom `withRequestScope`).
- [ ] Use only `HandlerTestBase` assertion helpers (`assert`, `assertEq`, `assertCtxUUID`, etc.).
- [ ] Use `this.suffix()` for any fields (email, username, phone, etc.) that could collide across tests or test runs.

### 7.3 Export `getScenarios()`

- [ ] `export async function getScenarios() { ... }`
- [ ] Return an array of scenario descriptors with:
  - [ ] `id`
  - [ ] `name`
  - [ ] `shortCircuitOnFail`
  - [ ] `expectedError` (for documentation; enforcement via `expectedError()` override)
  - [ ] `async run() { const test = new ScenarioTest(); return await test.run(); }`

### 7.4 Use only declared seed fields

- [ ] Only pass fields declared on `HandlerTestSeed` to `makeCtx` (e.g., `requestId`, `dtoType`, `op`, `body`, `bag`, `pipeline`, `slug`, `headers`).
- [ ] If you need more, extend `HandlerTestSeed` in `HandlerTestBase.ts` **first**, then use it.

### 7.5 Prefer injection hooks over monkey-patching

- [ ] If the handler exposes injection hooks via `ctx` (e.g., `signup.passwordHashFn`), use those for sad-path simulations.
- [ ] Do **not** monkey-patch Node built-ins (`crypto`, etc.); that creates `test_bug` scenarios instead of clean sad-path rails.

### 7.6 DTO-backed tests

- [ ] For any test that needs a DTO-backed inbound JSON shape, **never** hand-roll JSON.
- [ ] Always use the shared DTO registry (`new userRegistry().newUserDto()` or equivalent) to mint a short-lived DTO.
- [ ] Set internal fields via the DTO’s setters only.
- [ ] Call `dto.toBody()` to obtain the JSON, and build bags from that shape.
- [ ] Use `this.suffix()` to keep identity fields unique (emails, names, etc.).

When this checklist is followed, the test-runner can:

- Discover tests automatically.
- Run them under real rails.
- Classify outcomes consistently.
- Give you clean Mongo records where **happy and sad paths both show as “Passed”**, and **only real bugs show as “Failed” or “TestError”**.
