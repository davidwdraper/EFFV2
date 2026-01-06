// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/UserSignupPL.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 * - ADR-0099 (Strict missing-test semantics)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 *
 * Purpose:
 * - Domain-named pipeline for Auth Signup (dtoType="user").
 *
 * Ladder rule (this refactor):
 * - Start with exactly ONE seeder→handler pair (rung #1), get it green, then add rung #2.
 */

import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import {
  PipelineBase,
  type StepDefLive,
  type StepDefTest,
  type RunMode,
} from "@nv/shared/base/pipeline/PipelineBase";

import { AuthSignupController } from "../../auth.signup.controller";

import { CodeMintUuidHandler } from "@nv/shared/http/handlers/code.mint.uuid";

export class UserSignupPL extends PipelineBase {
  public override pipelineName(): string {
    return "UserSignupPL";
  }

  public static createController(app: AppBase): ControllerBase {
    return new AuthSignupController(app);
  }

  /**
   * RUNG #1 ONLY:
   * - seed: noop
   * - handler: code.mint.uuid
   */
  protected override buildPlan(): StepDefTest[] {
    return [
      {
        handlerName: "code.mint.uuid",
        seedName: "seed.code.mint.uuid",
        seedSpec: { rules: [] }, // explicit noop seeding
        handlerCtor: CodeMintUuidHandler,
        expectedTestName: "default",
      },
    ];
  }
}

export function createController(app: AppBase): ControllerBase {
  return UserSignupPL.createController(app);
}

export function getPipelineSteps(runMode: "live"): StepDefLive[];
export function getPipelineSteps(runMode: "test"): StepDefTest[];
export function getPipelineSteps(
  runMode: RunMode = "live"
): StepDefLive[] | StepDefTest[] {
  const pl = new UserSignupPL();
  return pl.getStepDefs(runMode as any);
}
