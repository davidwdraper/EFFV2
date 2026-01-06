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
 * - getPipelineSteps(runMode?) MUST return:
 *     - StepDefLive[] for "live"
 *     - StepDefTest[] for "test"
 */

import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import {
  PipelineBase,
  type StepDefLive,
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
   * Base class will validate + strip expectedTestName for "live".
   */
  protected override buildPlan(): StepDefTest[] {
    return [
      {
        // MUST be stable; drives default "<handlerName>.test.js"
        handlerName: "code.mint.uuid",
        handlerCtor: CodeMintUuidHandler,

        // optional; undefined => "default" (via normalizeExpectedTestName)
        expectedTestName: "default",
      },

      /*
      {
        handlerName: "h_seed.signup.userId.fromStepUuid",
        handlerCtor: HSeedSignupUserIdFromStepUuid,
        // expectedTestName omitted on purpose (defaults to "default")
      },
      */
    ];
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
 * - runMode="live" => StepDefLive[]
 * - runMode="test" => StepDefTest[]
 */
export function getPipelineSteps(runMode: "live"): StepDefLive[];
export function getPipelineSteps(runMode: "test"): StepDefTest[];
export function getPipelineSteps(
  runMode: RunMode = "live"
): StepDefLive[] | StepDefTest[] {
  const pl = new UserSignupPL();
  return pl.getStepDefs(runMode as any);
}

/*

      new CodeMintUuidHandler(ctx, controller),
      /*
      // Helpers: translate baton + apply onto hydrated DTO
      new HSeedSignupUserIdFromStepUuid(ctx, controller, {
        fromKey: "step.uuid",
        toKey: "signup.userId",
      }),
      new HApplySignupUserIdToUserBag(ctx, controller, {
        userIdKey: "signup.userId",
        bagKey: "bag",
      }),

      new CodeExtractPasswordHandler(ctx, controller),
      new CodePasswordHashHandler(ctx, controller),
      new S2sUserCreateHandler(ctx, controller),
      new S2sUserAuthCreateHandler(ctx, controller),
      new CodeMintUserAuthTokenHandler(ctx, controller),

      // Helper seeds rollback config + gate
      new HSeedRollbackDeleteUserOnAuthFailure(ctx, controller, {
        slug: "user",
        version: 1,
        dtoType: "user",
      }),

      // Shared generic rollback handler
      new S2sRollbackDeleteHandler(ctx, controller),
*/
