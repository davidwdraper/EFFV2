// backend/services/test-runner/src/controllers/run.controller/pipelines/run.handlerPipeline/code.guard.dbStateAndMockMode.test.ts
/**
 * Docs:
 * - LDD-35 (Handler-level test-runner service)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Handler-level test for CodeGuardDbStateAndMockModeHandler.
 * - Validates that a safe non-prod DB_STATE + DB_MOCKS=true configuration
 *   allows the pipeline to proceed and stashes mockMode=true in ctx.
 */

import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { getLogger } from "@nv/shared/logger/Logger";

import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";
import { CodeGuardDbStateAndMockModeHandler } from "./code.guard.dbStateAndMockMode";

export class CodeGuardDbStateAndMockModeTest extends HandlerTestBase {
  public testId(): string {
    return "guard-dbstate-mockmode:happy-path-mock";
  }

  public testName(): string {
    return "CodeGuardDbStateAndMockMode allows non-prod DB_STATE with DB_MOCKS=true and sets mockMode=true";
  }

  protected async execute(): Promise<void> {
    const ctx = new HandlerContext();
    const log = getLogger({
      service: "test-runner",
      component: "CodeGuardDbStateAndMockModeTest",
    });

    // Minimal controller stub sufficient for HandlerBase.
    const controllerStub = {
      getApp() {
        return { log };
      },
      getDtoRegistry() {
        // Not needed for this handler test.
        throw new Error("DTO registry not needed for this test.");
      },
      getSvcEnv() {
        return {
          getVar(key: string): string | undefined {
            if (key === "DB_STATE") return "smoke";
            if (key === "DB_MOCKS") return "true";
            return undefined;
          },
        };
      },
    } as unknown as ControllerBase;

    const handler = new CodeGuardDbStateAndMockModeHandler(ctx, controllerStub);

    // Act
    await handler.run();

    // Assert: handlerStatus should remain ok/undefined and mockMode=true.
    const handlerStatus = ctx.get<string | undefined>("handlerStatus");
    const mockMode = ctx.get<boolean | undefined>("mockMode");

    this.assert(
      !handlerStatus || handlerStatus === "ok",
      `Expected handlerStatus to be ok/undefined, got "${handlerStatus}".`
    );

    this.assert(
      mockMode === true,
      `Expected mockMode=true for DB_STATE="smoke" and DB_MOCKS="true"; got "${mockMode}".`
    );
  }
}
