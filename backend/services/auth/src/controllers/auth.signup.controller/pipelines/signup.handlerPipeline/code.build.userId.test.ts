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
 */

import { HandlerTestBase } from "@nv/shared/http/handlers/testing/HandlerTestBase";

type ScenarioDepsLike = {
  step: { execute: (scenarioCtx: any) => Promise<void> };
  makeScenarioCtx: (seed: {
    requestId: string;
    dtoType?: string;
    op?: string;
  }) => any;
};

class CodeBuildUserIdHappyTest extends HandlerTestBase {
  private readonly deps: ScenarioDepsLike;

  public constructor(deps: ScenarioDepsLike) {
    super();
    this.deps = deps;
  }

  public testId(): string {
    return "auth.signup.code.build.userId.happy";
  }

  public testName(): string {
    return "auth.signup: CodeBuildUserIdHandler mints UUIDv4 on ctx['signup.userId']";
  }

  protected expectedError(): boolean {
    return false;
  }

  protected async execute(): Promise<void> {
    const ctx = this.deps.makeScenarioCtx({
      requestId: "req-auth-signup-build-user-id",
      dtoType: "auth.signup",
      op: "build.userId",
    });

    await this.deps.step.execute(ctx);

    this.assertEq(ctx.get("handlerStatus"), "ok");
    this.assertCtxUUID(ctx, "signup.userId");
  }
}

export async function getScenarios(deps: ScenarioDepsLike) {
  return [
    {
      id: "auth.signup.code.build.userId.happy",
      name: "auth.signup: CodeBuildUserIdHandler mints UUIDv4 on ctx['signup.userId']",
      shortCircuitOnFail: true,
      expectedError: false,
      async run(localDeps: ScenarioDepsLike) {
        const test = new CodeBuildUserIdHappyTest(localDeps);
        return await test.run();
      },
    },
  ];
}
