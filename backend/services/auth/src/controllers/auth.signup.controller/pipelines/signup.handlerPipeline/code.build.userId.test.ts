// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/code.build.userId.test.ts

/**
 * Docs:
 * - LDD-40 (Handler Test Design — fresh ctx per scenario)
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0057 (ID Generation & Validation — UUIDv4 only)
 *
 * Purpose:
 * - Happy-path test for CodeBuildUserIdHandler:
 *   ensure a valid UUIDv4 is written to ctx["signup.userId"].
 *
 * Scope:
 * - Single happy-path scenario only.
 * - No DtoBag involvement; handler is pure id minting on the bus.
 *
 * New test-runner contract (ScenarioRunner):
 * - This module is discovered via HandlerTestModuleLoader using:
 *     indexRelativePath + handlerName = "code.build.userId"
 * - It MUST export getScenarios(), which returns an array of
 *   scenario definitions with a run() function.
 * - ScenarioRunner will:
 *     • call getScenarios()
 *     • call each scenario.run()
 *     • push results into HandlerTestDto via dto.runScenario(...)
 */

import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import { CodeBuildUserIdHandler } from "./code.build.userId";

// Existing test harness, now used by the scenario definition.
export class CodeBuildUserIdTest extends HandlerTestBase {
  public testId(): string {
    return "auth.signup.code.build.userId.happy";
  }

  public testName(): string {
    return "auth.signup: CodeBuildUserIdHandler mints UUIDv4 on ctx['signup.userId']";
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

    // Rails verdict already enforced by runHandler(); now assert payload on the bus.
    this.assertCtxUUID(ctx, "signup.userId");
  }
}

/**
 * ScenarioRunner entrypoint:
 * - Single happy-path scenario for this handler.
 * - Returns a list of scenarios; each scenario's run() returns a HandlerTestResult.
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
        // HandlerTestBase.run() returns HandlerTestResult; ScenarioRunner
        // will treat that as the scenario's details.
        return await test.run();
      },
    },
  ];
}
