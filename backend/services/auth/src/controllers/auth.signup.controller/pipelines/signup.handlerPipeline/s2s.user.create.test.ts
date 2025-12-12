// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/s2s.user.create.test.ts
/**
 * Docs:
 * - LDD-35 (Handler-level test-runner service)
 * - LDD-36 (Handler Test SOP — per-handler patterns)
 * - ADR-0063 (Auth Signup MOS Pipeline)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Handler-level tests for S2sUserCreateHandler.
 * - Scenario 1: Happy path with valid ctx["bag"], env label, and SvcClient.
 * - Scenario 2: Sad path for missing ctx["bag"] guard.
 */

import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { getLogger } from "@nv/shared/logger/Logger";

import { DtoBag } from "@nv/shared/dto/DtoBag";
import { UserDto } from "@nv/shared/dto/user.dto";
import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";

import { S2sUserCreateHandler } from "./s2s.user.create";

type RecordedCall = {
  env: string;
  slug: string;
  version: number;
  dtoType: string;
  op: string;
  method: string;
  bag?: unknown;
  requestId?: string;
};

/** Local minimal assert helper until HandlerTestBase grows shared helpers. */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Scenario 1 — Happy Path
 *
 * - ctx["bag"] contains a singleton DtoBag<UserDto>.
 * - AppBase exposes getEnvLabel() + getSvcClient().
 * - SvcClient.call(...) is invoked once with the expected shape.
 * - ctx["signup.userCreateStatus"] = { ok: true, userId }.
 * - handlerStatus is "ok".
 * - ctx["bag"] remains the same instance (no reassignment).
 */
export class S2sUserCreate_HappyPath_Test extends HandlerTestBase {
  public testId(): string {
    return "auth.s2s.user.create:happy-path";
  }

  public testName(): string {
    return "auth s2s.user.create calls user.create and stamps signup.userCreateStatus on success";
  }

  protected async execute(): Promise<void> {
    const ctx = new HandlerContext();
    const log = getLogger({
      service: "auth",
      component: "S2sUserCreate_HappyPath_Test",
    });

    // Seed a realistic-ish UserDto bag using the DTO rails.
    const userDto = UserDto.fromBody(
      {
        givenName: "Test",
        lastName: "User",
        email: "test@example.com",
      },
      { validate: true }
    );

    const bag = new DtoBag<UserDto>([userDto]);

    ctx.set("bag", bag);
    ctx.set("signup.userId", "test-user-id-123");
    ctx.set("requestId", "req-test-123");

    const recordedCalls: RecordedCall[] = [];

    const svcClientStub = {
      async call<TBag>(opts: {
        env: string;
        slug: string;
        version: number;
        dtoType: string;
        op: string;
        method: string;
        bag?: TBag;
        id?: string;
        requestId?: string;
      }): Promise<TBag> {
        recordedCalls.push({ ...opts });
        // Echo the bag back as a best-effort "OK" response.
        return opts.bag as TBag;
      },
    };

    const appStub = {
      log,
      getEnvLabel(): string {
        return "dev";
      },
      getSvcClient() {
        return svcClientStub;
      },
    };

    const controllerStub = {
      getApp() {
        return appStub;
      },
      getDtoRegistry() {
        // Not needed for this handler.
        throw new Error(
          "DTO registry not needed for S2sUserCreate handler test."
        );
      },
      getSvcEnv() {
        // Not used by this handler; present for HandlerBase/env helpers.
        return {
          getVar(_key: string): string | undefined {
            return undefined;
          },
        };
      },
    } as unknown as ControllerBase;

    const handler = new S2sUserCreateHandler(ctx, controllerStub);

    // Act
    await handler.run();

    // Assert: handlerStatus should be ok/undefined.
    const handlerStatus = ctx.get<string | undefined>("handlerStatus");
    assert(
      !handlerStatus || handlerStatus === "ok",
      `Expected handlerStatus to be ok/undefined, got "${handlerStatus}".`
    );

    // Assert: exactly one SvcClient call was made.
    assert(
      recordedCalls.length === 1,
      `Expected exactly one SvcClient.call invocation, got ${recordedCalls.length}.`
    );

    const call = recordedCalls[0];

    assert(call.env === "dev", `Expected env="dev", got "${call.env}".`);
    assert(call.slug === "user", `Expected slug="user", got "${call.slug}".`);
    assert(call.version === 1, `Expected version=1, got "${call.version}".`);
    assert(
      call.dtoType === "user",
      `Expected dtoType="user", got "${call.dtoType}".`
    );
    assert(call.op === "create", `Expected op="create", got "${call.op}".`);
    assert(
      call.method === "PUT",
      `Expected method="PUT", got "${call.method}".`
    );
    assert(
      call.requestId === "req-test-123",
      `Expected requestId="req-test-123", got "${call.requestId}".`
    );

    // Assert: signup.userCreateStatus OK + userId.
    const status = ctx.get<{
      ok: boolean;
      userId?: string;
      code?: string;
      message?: string;
    }>("signup.userCreateStatus");

    assert(
      !!status && status.ok === true,
      `Expected signup.userCreateStatus.ok === true, got ${JSON.stringify(
        status
      )}.`
    );

    assert(
      status.userId === "test-user-id-123",
      `Expected signup.userCreateStatus.userId="test-user-id-123", got "${status?.userId}".`
    );

    // Assert: ctx["bag"] instance is unchanged.
    const bagAfter = ctx.get<DtoBag<UserDto>>("bag");
    assert(
      bagAfter === bag,
      "Expected ctx['bag'] to be the same DtoBag instance after S2sUserCreateHandler."
    );
  }
}

/**
 * Scenario 2 — Sad Path: Missing ctx["bag"]
 *
 * - ctx["bag"] is not set.
 * - Handler must:
 *   • set signup.userCreateStatus.ok === false with the expected code,
 *   • mark handlerStatus="error" via failWithError(),
 *   • NOT attempt to call SvcClient.
 */
export class S2sUserCreate_MissingBag_Test extends HandlerTestBase {
  public testId(): string {
    return "auth.s2s.user.create:missing-bag";
  }

  public testName(): string {
    return "auth s2s.user.create fails with missing ctx['bag'] and sets signup.userCreateStatus.ok=false";
  }

  protected async execute(): Promise<void> {
    const ctx = new HandlerContext();
    const log = getLogger({
      service: "auth",
      component: "S2sUserCreate_MissingBag_Test",
    });

    ctx.set("requestId", "req-test-missing-bag");

    const recordedCalls: RecordedCall[] = [];

    const svcClientStub = {
      async call<TBag>(opts: {
        env: string;
        slug: string;
        version: number;
        dtoType: string;
        op: string;
        method: string;
        bag?: TBag;
        id?: string;
        requestId?: string;
      }): Promise<TBag> {
        recordedCalls.push({ ...opts });
        throw new Error("SvcClient should not be called when bag is missing.");
      },
    };

    const appStub = {
      log,
      getEnvLabel(): string {
        return "dev";
      },
      getSvcClient() {
        return svcClientStub;
      },
    };

    const controllerStub = {
      getApp() {
        return appStub;
      },
      getDtoRegistry() {
        throw new Error(
          "DTO registry not needed for S2sUserCreate handler test."
        );
      },
      getSvcEnv() {
        return {
          getVar(_key: string): string | undefined {
            return undefined;
          },
        };
      },
    } as unknown as ControllerBase;

    const handler = new S2sUserCreateHandler(ctx, controllerStub);

    // Act
    await handler.run();

    // Assert: handlerStatus should be "error".
    const handlerStatus = ctx.get<string | undefined>("handlerStatus");
    assert(
      handlerStatus === "error",
      `Expected handlerStatus="error" when ctx['bag'] is missing, got "${handlerStatus}".`
    );

    // Assert: SvcClient was never called.
    assert(
      recordedCalls.length === 0,
      `Expected no SvcClient calls when ctx['bag'] is missing, got ${recordedCalls.length}.`
    );

    // Assert: signup.userCreateStatus.ok === false with the expected code.
    const status = ctx.get<{
      ok: boolean;
      code?: string;
      message?: string;
    }>("signup.userCreateStatus");

    assert(
      !!status && status.ok === false,
      `Expected signup.userCreateStatus.ok === false, got ${JSON.stringify(
        status
      )}.`
    );

    assert(
      status.code === "AUTH_SIGNUP_MISSING_USER_BAG",
      `Expected signup.userCreateStatus.code="AUTH_SIGNUP_MISSING_USER_BAG", got "${status?.code}".`
    );
  }
}
