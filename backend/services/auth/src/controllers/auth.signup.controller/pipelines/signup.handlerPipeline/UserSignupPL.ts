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
 * - Add one rung at a time: get green, then add the next rung.
 *
 * Readability rule:
 * - buildPlan() is a list of private step factory functions.
 * - Each function name is camelCased from handlerName.
 *
 * ADR-0101 seeding defaults:
 * - If a step omits seeding entirely, rails treat it as:
 *     seedName = "noop"
 *     seedSpec = {}
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
import { CodeSetDtoIdHandler } from "@nv/shared/http/handlers/code.set.dtoId";

export class UserSignupPL extends PipelineBase {
  public override pipelineName(): string {
    return "UserSignupPL";
  }

  public static createController(app: AppBase): ControllerBase {
    return new AuthSignupController(app);
  }

  protected override buildPlan(): StepDefTest[] {
    return [
      // RUNG #1: mint baton uuid
      this.codeMintUuid(),

      // RUNG #2: apply baton uuid onto dto._id (no seeding required; baton already exists)
      this.codeSetDtoId(),
    ];
  }

  // ───────────────────────────────────────────
  // Steps (camelCased from handlerName)
  // ───────────────────────────────────────────

  private codeMintUuid(): StepDefTest {
    return {
      handlerName: "code.mint.uuid",
      handlerCtor: CodeMintUuidHandler,
      expectedTestName: "default",
    };
  }

  private codeSetDtoId(): StepDefTest {
    return {
      handlerName: "code.set.dtoId",
      handlerCtor: CodeSetDtoIdHandler,
      expectedTestName: "default",
    };
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
