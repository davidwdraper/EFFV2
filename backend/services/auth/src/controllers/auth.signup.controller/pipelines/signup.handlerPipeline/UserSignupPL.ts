// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/UserSignupPL.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 * - ADR-0099 (Strict missing-test semantics)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 *
 * Purpose:
 * - Domain-named pipeline for Auth Signup (dtoType="user").
 *
 * Invariants:
 * - Pipeline planning is PURE:
 *   - No handler instantiation.
 *   - No handler execution.
 * - Handlers are instantiated only during scenario execution.
 *
 * Loader contract:
 * - createController(app) MUST exist.
 * - getPipelineSteps(runMode?) MUST return StepDefProd[] for "prod", StepDefTest[] for "test".
 */

import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import {
  PipelineBase,
  type StepDefProd,
  type StepDefTest,
  type RunMode,
} from "@nv/shared/base/pipeline/PipelineBase";

import { AuthSignupController } from "../../auth.signup.controller";
import { CodeMintUuidHandler } from "@nv/shared/http/handlers/code.mint.uuid";

/**
 * Domain-named pipeline artifact.
 */
export class UserSignupPL extends PipelineBase {
  public override pipelineName(): string {
    return "UserSignupPL";
  }

  public static createController(app: AppBase): ControllerJsonBase {
    return new AuthSignupController(app);
  }

  /**
   * Single source of truth: step plan + expected test directive live together.
   *
   * - runMode="prod": returns StepDefProd[] (no expectedTestName field)
   * - runMode="test": returns StepDefTest[] (expectedTestName available)
   */
  public override steps(runMode: "prod"): StepDefProd[];
  public override steps(runMode: "test"): StepDefTest[];
  public override steps(
    runMode: RunMode = "prod"
  ): StepDefProd[] | StepDefTest[] {
    const plan: StepDefTest[] = [
      {
        // MUST be stable; drives default "<handlerName>.test.js"
        handlerName: "code.mint.uuid",
        handlerCtor: CodeMintUuidHandler,

        // "default" => derive <handlerName>.test.js
        // "skipped" => intentional opt-out
        // otherwise  => explicit override module basename (no ".js" enforced here)
        expectedTestName: "default",
      },

      /*
      {
        handlerName: "h.seed.signup.userId.from.stepUuid",
        handlerCtor: HSeedSignupUserIdFromStepUuidHandler,
        expectedTestName: "default",
      },
      */
    ];

    // Rails check: we validate the full plan once, then optionally strip for prod callers.
    this.validatePlans(plan);

    if (runMode === "test") {
      return plan;
    }

    // prod mode: strip expectedTestName from the returned shape
    return plan.map(({ expectedTestName: _ignored, ...prod }) => prod);
  }
}

/**
 * Runner entrypoint (required).
 */
export function createController(app: AppBase): ControllerJsonBase {
  return UserSignupPL.createController(app);
}

/**
 * Runner entrypoint (plan):
 * - runMode="prod" => StepDefProd[]
 * - runMode="test" => StepDefTest[]
 */
export function getPipelineSteps(runMode: "prod"): StepDefProd[];
export function getPipelineSteps(runMode: "test"): StepDefTest[];
export function getPipelineSteps(
  runMode: RunMode = "prod"
): StepDefProd[] | StepDefTest[] {
  const pl = new UserSignupPL();
  return pl.steps(runMode as any);
}
