// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/UserSignupPL.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 * - ADR-0098 (Domain-named pipelines with PL suffix)
 *
 * Purpose:
 * - Domain-named pipeline for Auth Signup (dtoType="user").
 *
 * Invariants:
 * - Controller owns orchestration metadata seeding (S2S routing keys, dtoType/op, etc).
 * - Pipeline composes ordered steps.
 * - Pipeline helpers ("h_") may seed ctx keys and may accept args.
 * - Generic handlers remain slug-agnostic and rely on helpers for domain wiring.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import { AuthSignupController } from "../../auth.signup.controller";

import { CodeMintUuidHandler } from "@nv/shared/http/handlers/code.mint.uuid";
import { CodeExtractPasswordHandler } from "./code.extractPassword";
import { CodePasswordHashHandler } from "./code.passwordHash";
import { S2sUserCreateHandler } from "./s2s.user.create";
import { S2sUserAuthCreateHandler } from "./s2s.userAuth.create";
import { CodeMintUserAuthTokenHandler } from "./code.mintUserAuthToken";

import { S2sRollbackDeleteHandler } from "@nv/shared/http/handlers/s2s.rollbackDelete";

import { HSeedSignupUserIdFromStepUuid } from "./h_seed.signup.userId.fromStepUuid";
import { HApplySignupUserIdToUserBag } from "./h_apply.signup.userId.toUserBag";
import { HSeedRollbackDeleteUserOnAuthFailure } from "./h_seed.rollback.deleteUser.onAuthFailure";

/**
 * Domain-named pipeline artifact.
 */
export class UserSignupPL {
  public static pipelineName(): string {
    return "UserSignupPL";
  }

  public static createController(app: AppBase): ControllerJsonBase {
    return new AuthSignupController(app);
  }

  public static getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
    return [
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
    ];
  }
}
