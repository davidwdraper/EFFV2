// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/UserSignupPL.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 * - ADR-0099 (Strict missing-test semantics)
 * - ADR-0100 (Pipeline plans + manifest-driven handler tests)
 * - ADR-0101 (Universal seeder + seeder→handler pairs)
 * - ADR-0102 (Registry sole DTO creation authority + _id minting rules)
 *
 * Purpose:
 * - Domain-named pipeline for Auth Signup (dtoType="user").
 *
 * Key invariant (ADR-0102):
 * - Signup is Scenario B (edge hydration):
 *   - Controller hydrates DTO via registry.create(dtoKey, body)
 *   - DTO ctor hydration MUST require _id (UUIDv4) and MUST NOT mint
 * - Therefore this pipeline MUST NOT mint or assign dto._id.
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

import { CodePasswordHashHandler } from "./code.passwordHash";
import { S2sUserCreateHandler } from "./s2s.user.create";
import { S2sUserAuthCreateHandler } from "./s2s.userAuth.create";
import { CodeMintUserAuthTokenHandler } from "./code.mintUserAuthToken";
import { S2sUserDeleteOnFailureHandler } from "./s2s.user.delete.onFailure";

export class UserSignupPL extends PipelineBase {
  public override pipelineName(): string {
    return "UserSignupPL";
  }

  public static createController(app: AppBase): ControllerBase {
    return new AuthSignupController(app);
  }

  protected override buildPlan(): StepDefTest[] {
    return [
      // RUNG #1: hash password from inbound header (or other seeded source)
      this.codePasswordHash(),

      // RUNG #2: call user.create with hydrated bag (controller owns hydration)
      this.s2sUserCreate(),

      // RUNG #3: persist credentials via user-auth worker
      // IMPORTANT: on failure this step sets ctx["signup.rollbackUserRequired"]=true
      // and keeps the pipeline rail "ok" so rollback can run.
      this.s2sUserAuthCreate(),

      // RUNG #4: rollback/delete (LIVE: only when rollbackUserRequired===true)
      // NOTE: any rollback baton must NOT be dto._id.
      this.s2sUserDeleteOnFailure(),

      // RUNG #5: mint client auth JWT (no-op unless rung #2 and #3 both ok)
      this.codeMintUserAuthToken(),
    ];
  }

  private codePasswordHash(): StepDefTest {
    return {
      handlerName: "code.passwordHash",
      handlerCtor: CodePasswordHashHandler,
      expectedTestName: "default",
    };
  }

  private s2sUserCreate(): StepDefTest {
    return {
      handlerName: "s2s.user.create",
      handlerCtor: S2sUserCreateHandler,
      expectedTestName: "default",
    };
  }

  private s2sUserAuthCreate(): StepDefTest {
    return {
      handlerName: "s2s.userAuth.create",
      handlerCtor: S2sUserAuthCreateHandler,
      expectedTestName: "default",
    };
  }

  private s2sUserDeleteOnFailure(): StepDefTest {
    return {
      handlerName: "s2s.user.delete.onFailure",
      handlerCtor: S2sUserDeleteOnFailureHandler,
      expectedTestName: "default",
    };
  }

  private codeMintUserAuthToken(): StepDefTest {
    return {
      handlerName: "code.mintUserAuthToken",
      handlerCtor: CodeMintUserAuthTokenHandler,
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
