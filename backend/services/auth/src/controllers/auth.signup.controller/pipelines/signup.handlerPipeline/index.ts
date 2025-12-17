// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "user" SIGNUP.
 * - Auth acts as a MOS: it coordinates User + UserAuth, instead of owning its own DTO.
 *
 * Flow (MOS v1, with outbound S2S + token mint + compensating rollback):
 *  1) BuildSignupUserIdHandler
 *  2) HydrateUserBagHandler
 *  3) ExtractPasswordHandler
 *  4) GeneratePasswordHashHandler
 *  5) CallUserCreateHandler
 *  6) CallUserAuthCreateHandler
 *  7) MintUserAuthTokenHandler
 *  8) RollbackUserOnAuthCreateFailureHandler
 *
 * Test-Runner Contract:
 * - Pipelines MUST declare their controller via createController(app).
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { AppBase } from "@nv/shared/base/app/AppBase";

import { AuthSignupController } from "../../auth.signup.controller";

import { CodeBuildUserIdHandler } from "./code.build.userId";
import { ToBagUserHandler } from "./toBag.User";
import { CodeExtractPasswordHandler } from "./code.extractPassword";
import { CodePasswordHashHandler } from "./code.passwordHash";
import { S2sUserCreateHandler } from "./s2s.user.create";
import { S2sUserAuthCreateHandler } from "./s2s.userAuth.create";
import { CodeMintUserAuthTokenHandler } from "./code.mintUserAuthToken";
import { S2sUserDeleteOnFailureHandler } from "./s2s.user.delete.onFailure";

/**
 * Deterministic controller factory.
 * Controllers are APP-scoped, not CTX-scoped.
 */
export function createController(app: AppBase): ControllerJsonBase {
  return new AuthSignupController(app);
}

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // S2S metadata: used by handlers (or future policy gates) if needed.
  ctx.set("s2s.slug.user", "user");
  ctx.set("s2s.version.user", 1);

  ctx.set("s2s.slug.userAuth", "user-auth");
  ctx.set("s2s.version.userAuth", 1);

  return [
    new CodeBuildUserIdHandler(ctx, controller),
    new ToBagUserHandler(ctx, controller),
    new CodeExtractPasswordHandler(ctx, controller),
    new CodePasswordHashHandler(ctx, controller),
    new S2sUserCreateHandler(ctx, controller),
    new S2sUserAuthCreateHandler(ctx, controller),
    new CodeMintUserAuthTokenHandler(ctx, controller),
    new S2sUserDeleteOnFailureHandler(ctx, controller),
  ];
}
