// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.build.userId.test.ts

/**
 * Docs:
 * - Build-a-test-guide (Handler-level test pattern)
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0057 (ID Generation & Validation — UUIDv4 only)
 *
 * Purpose:
 * - Happy-path smoke test for CodeBuildUserIdHandler:
 *   ensure a valid UUIDv4 is written to ctx["signup.userId"] and the handler
 *   remains on the "ok" rail.
 *
 * Scope:
 * - Single happy-path scenario only.
 * - No DtoBag involvement; handler is pure id minting on the bus.
 *
 * Test-runner contract:
 * - This module is discovered via HandlerTestModuleLoader using:
 *     indexRelativePath + handlerName = "code.build.userId"
 * - It MUST:
 *     • export CodeBuildUserIdTest (canonical test class)
 *     • export getScenarios(), which returns an array of scenario definitions.
 */

import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import { CodeBuildUserIdHandler } from "./code.build.userId";

export class CodeBuildUserIdTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.code.build.userId.happy";
  }

  public testName(): string {
    return "auth.signup: CodeBuildUserIdHandler mints UUIDv4 on ctx['signup.userId']";
  }

  protected expectedError(): boolean {
    // Happy-path smoke: handlerStatus !== "error".
    return false;
  }

  protected async execute(): Promise<void> {
    // Fresh context per LDD-40; handler only cares about requestId + bus.
    const ctx = this.makeCtx({
      requestId: "req-auth-signup-build-user-id",
      dtoType: "auth.signup",
      op: "build.userId",
    });

    await this.runHandler({
      handlerCtor: CodeBuildUserIdHandler,
      ctx,
    });

    // Assert final handler rail (HTTP status is derived later by rails, not by the test).
    this.assertEq(ctx.get("handlerStatus"), "ok");

    // Assert payload on the bus: UUIDv4 written to ctx["signup.userId"].
    this.assertCtxUUID(ctx, "signup.userId");
  }
}

/**
 * ScenarioRunner entrypoint:
 * - Single happy-path scenario for this handler.
 * - Even with one scenario, we follow the same pattern so all tests
 *   look identical to future you.
 */
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
