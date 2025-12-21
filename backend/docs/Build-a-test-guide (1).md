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

The test module will live **next to it** (same folder).

### 3.2 hasTest()

Opt-in for the test-runner:

```ts
public override hasTest(): boolean {
  return true;
}
```

If `hasTest()` is `false`, StepIterator/ScenarioRunner will **skip** this handler entirely.

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

### 3.4 Optional: runTest for legacy

Handlers may still implement `runTest()` to support older rails, e.g.:

```ts
import { ToBagUserTest } from "./toBag.user.test";

public override async runTest(): Promise<HandlerTestResult | undefined> {
  return this.runSingleTest(ToBagUserTest);
}
```

This is **optional** under the new design; the test-runner uses `getScenarios()` instead.

---

## 4. Test Module Requirements

For every handler that sets `hasTest() === true`, there must be a matching test module:

```text
<handler-folder>/<handlerName>.test.ts
```

Examples:

- Handler: `"code.build.userId"` → `code.build.userId.test.ts`
- Handler: `"toBag.user"` → `toBag.user.test.ts`

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
      // expectedError: false by default
    });

    // Assertions using HandlerTestBase helpers:
    //   this.assertEq(...);
    //   this.assertCtxUUID(ctx, "some.key");
    //   etc.
  }
}
```

For a **sad-path** scenario (expected handler error), pass `expectedError: true` into `runHandler()` and assert on `handlerStatus`, `status` / `response.status`, etc.

### 4.2 `getScenarios()` contract

This is the **critical contract** that the test-runner depends on.

Pattern from the working `code.build.userId` test:

```ts
export async function getScenarios() {
  return [
    {
      id: "auth.signup.code.build.userId.happy",
      name: "auth.signup: CodeBuildUserIdHandler mints UUIDv4 on ctx['signup.userId']",
      shortCircuitOnFail: true,
      expectedError: false,
      async run() {
        const test = new CodeBuildUserIdTest();
        return await test.run();
      },
    },
  ];
}
```

Key points:

- **Async** `getScenarios()` is fine (and expected).
- It returns an **array** of scenario objects.
- Each scenario object must have at least:
  - `id: string` — unique per scenario (used in `HandlerTestDto`).
  - `name: string` — human-readable description.
  - `shortCircuitOnFail: boolean` — if `true`, the runner stops after this scenario fails.
  - `expectedError: boolean` — tells the runner whether failure is expected at the rail level (used by the DTO/rails; keep consistent).
  - `run: () => Promise<HandlerTestResult>` — creates the test instance and calls `test.run()`.

Inside `run()`, always do:

```ts
const test = new MyScenarioTest();
return await test.run();
```

**Never** call `execute()` directly; the base `run()` wrapper handles timing, pass/fail status, and result shape.

### 4.3 Optional back-compat alias

If a handler still calls `runSingleTest(SomeTest)`, you can provide an alias:

```ts
export { ToBagUserHappyTest as ToBagUserTest };
```

This lets the handler’s legacy `runTest()` keep working while the new `getScenarios()` API powers the test-runner.

### 4.4 `HandlerTestSeed` and `makeCtx()`

All tests call `this.makeCtx(seed)` where `seed` is a `HandlerTestSeed`.  
To avoid TypeScript “object literal may only specify known properties” errors and keep the bus consistent, tests must only pass **declared** properties:

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

- If you need another seed field, **add it to `HandlerTestSeed`** in `HandlerTestBase.ts`, do not sneak it into the object literal.
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

- When you want to test “no headers” vs “missing specific header”, still use the `headers` property:

  ```ts
  // Explicitly: no headers at all
  const ctx = this.makeCtx({
    requestId: "req-auth-signup-codeExtractPassword-missing",
    dtoType: "user",
    op: "code.extract.password",
    headers: {}, // Handler sees an empty headers bag
  });
  ```

`HandlerTestBase.seedDefaults()` knows how to map these seed fields onto the `HandlerContext` bus (e.g., `ctx["headers"]`), so tests only worry about deltas.

---

## 5. Concrete Examples

### 5.1 Single-scenario handler — `code.build.userId`

**Handler:** `code.build.userId.ts`

- `getHandlerName()` (or `handlerName()`): `"code.build.userId"`
- `hasTest()` returns `true` when wired in for tests.

**Test module:** `code.build.userId.test.ts`

```ts
import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
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
      async run() {
        const test = new CodeBuildUserIdTest();
        return await test.run();
      },
    },
  ];
}
```

This is the **canonical single-scenario pattern**.

### 5.2 Multi-scenario handler — `toBag.user`

**Handler:** `toBag.user.ts`

- `handlerName(): "toBag.user"`
- `hasTest(): true`

**Test module:** `toBag.user.test.ts`

Two scenarios: **happy** and **sad**.

```ts
import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import type { BagItemWire } from "@nv/shared/registry/RegistryBase";

import { UserDtoRegistry } from "@nv/shared/dto/registry/user.dtoRegistry";
import { ToBagUserHandler } from "./toBag.user";

const TEST_USER_ID_V4 = "550e8400-e29b-41d4-a716-446655440000";

export class ToBagUserHappyTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.toBag.user.happy";
  }

  public testName(): string {
    return "auth.signup: ToBagUserHandler hydrates singleton UserDto bag and applies signup.userId";
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-signup-toBagUser-happy",
      dtoType: "user",
      op: "toBag.user",
      body: { items: [makeUserWireItem("0000001")] },
    });

    ctx.set("signup.userId", TEST_USER_ID_V4);

    await this.runHandler({
      handlerCtor: ToBagUserHandler,
      ctx,
    });

    const handlerStatus = ctx.get<string>("handlerStatus");
    this.assertEq(
      String(handlerStatus ?? ""),
      "ok",
      "handlerStatus should be 'ok' on happy path"
    );

    const bag: any = ctx.get("bag");
    this.assertEq(String(bag != null), "true", "ctx['bag'] should be defined");

    const iterable: Iterable<any> =
      bag && typeof bag.items === "function"
        ? (bag.items() as Iterable<any>)
        : ((bag?._items ?? []) as Iterable<any>);

    const items: any[] = Array.from(iterable);
    this.assertEq(
      String(items.length),
      "1",
      "DtoBag should contain exactly one UserDto"
    );

    const userDto: any = items[0];
    const dtoId =
      userDto && typeof userDto.getId === "function"
        ? userDto.getId()
        : undefined;

    this.assertEq(
      String(dtoId ?? ""),
      TEST_USER_ID_V4,
      "UserDto id should match ctx['signup.userId']"
    );
  }
}

export class ToBagUserMissingUserIdTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.toBag.user.missingSignupUserId";
  }

  public testName(): string {
    return "auth.signup: ToBagUserHandler fails with 500 when signup.userId is missing";
  }

  protected async execute(): Promise<void> {
    const ctx = this.makeCtx({
      requestId: "req-auth-signup-toBagUser-missingUserId",
      dtoType: "user",
      op: "toBag.user",
      body: { items: [makeUserWireItem("0000002")] },
    });

    await this.runHandler({
      handlerCtor: ToBagUserHandler,
      ctx,
      expectedError: true,
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
      "handlerStatus should be 'error' when signup.userId is missing"
    );

    this.assertEq(
      String(statusCode ?? ""),
      "500",
      "status should be 500 for missing signup.userId precondition"
    );
  }
}

// Helper to build a canonical User wire item
function makeUserWireItem(suffix: string): BagItemWire {
  const registry = new UserDtoRegistry();
  const dto: any = registry.newUserDto();

  dto.setGivenName?.("Signup");
  dto.setLastName?.("User");
  dto.setEmail?.(`signup.user+${suffix}@example.com`);

  dto.setPhone?.(`+1555${suffix.padStart(7, "0")}`);
  dto.setHomeLat?.(37.7749);
  dto.setHomeLng?.(-122.4194);
  dto.setAddress1?.("123 Test St");
  dto.setCity?.("Testville");
  dto.setState?.("CA");
  dto.setPcode?.("94101");

  const userJson = dto.toBody() as Record<string, unknown>;

  return { type: "user", ...userJson } as BagItemWire;
}

// Optional: alias for legacy runSingleTest()
export { ToBagUserHappyTest as ToBagUserTest };

export async function getScenarios() {
  return [
    {
      id: "auth.signup.toBag.user.happy",
      name: "auth.signup: ToBagUserHandler hydrates singleton UserDto bag and applies signup.userId",
      shortCircuitOnFail: true,
      expectedError: false,
      async run() {
        const test = new ToBagUserHappyTest();
        return await test.run();
      },
    },
    {
      id: "auth.signup.toBag.user.missingSignupUserId",
      name: "auth.signup: ToBagUserHandler fails with 500 when signup.userId is missing",
      shortCircuitOnFail: true,
      expectedError: false, // handler will rail; test itself asserts that
      async run() {
        const test = new ToBagUserMissingUserIdTest();
        return await test.run();
      },
    },
  ];
}
```

---

## 6. Checklist for New Tests

When you add a new handler test:

1. **Update the handler**

   - [ ] Ensure `hasTest(): true`.
   - [ ] Ensure `handlerName()` (or `getHandlerName()`) returns the intended name.
   - [ ] Confirm that `<handlerName>.test.ts` will sit next to the handler file.

2. **Create the test module**

   - [ ] File name: `<handlerName>.test.ts`.
   - [ ] For each scenario:
     - [ ] Create a `HandlerTestBase` subclass.
     - [ ] Implement `testId()` and `testName()`.
     - [ ] Implement `execute()` using `makeCtx()` and `runHandler()`.
     - [ ] Add assertions for ctx/bag as needed.

3. **Export getScenarios()**

   - [ ] `export async function getScenarios() { ... }`
   - [ ] Return an array of scenario objects with:
     - [ ] `id`
     - [ ] `name`
     - [ ] `shortCircuitOnFail`
     - [ ] `expectedError`
     - [ ] `async run() { const test = new ScenarioTest(); return await test.run(); }`

4. **Use only declared seed fields**

   - [ ] Only pass fields declared on `HandlerTestSeed` to `makeCtx` (e.g., `requestId`, `dtoType`, `op`, `body`, `bag`, `pipeline`, `slug`, `headers`).
   - [ ] If you need more, extend `HandlerTestSeed` in `HandlerTestBase.ts` **first**, then use it.

5. **Optional legacy support**
   - [ ] Export an alias (e.g., `export { FooHappyTest as FooTest };`)
   - [ ] Wire `runTest()` in the handler if needed.
