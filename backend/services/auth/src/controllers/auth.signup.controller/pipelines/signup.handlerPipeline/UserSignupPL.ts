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
      // RUNG #1: mint baton uuid (ctx["step.uuid"])
      this.codeMintUuid(),

      // RUNG #2: apply baton uuid onto dto._id
      this.codeSetDtoId(),

      // RUNG #3: hash password from inbound header
      this.codePasswordHash(),

      // RUNG #4: call user.create with hydrated bag
      this.s2sUserCreate(),

      // RUNG #5: persist credentials via user-auth worker
      // IMPORTANT: on failure this step sets ctx["signup.rollbackUserRequired"]=true
      // and keeps the pipeline rail "ok" so rollback can run.
      this.s2sUserAuthCreate(),

      // RUNG #6: rollback/delete (LIVE: only when rollbackUserRequired===true)
      // TEST: always cleanup delete using ctx["step.uuid"].
      // This step sets the general pipeline rail to "error" when rollback was required,
      // preventing token minting from running.
      this.s2sUserDeleteOnFailure(),

      // RUNG #7: mint client auth JWT (no-op unless rung #4 and #5 both ok)
      this.codeMintUserAuthToken(),
    ];
  }

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
