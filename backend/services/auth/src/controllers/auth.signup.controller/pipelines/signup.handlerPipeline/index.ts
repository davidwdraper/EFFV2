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
 *     - Decide the canonical user id for signup; stash on ctx["signup.userId"].
 *  2) HydrateUserBagHandler
 *     - Validate wire bag envelope; hydrate UserDto via Registry;
 *       put DtoBag<UserDto> on ctx["bag"].
 *  3) ExtractPasswordHandler
 *     - Read password from header; validate; stash safely on
 *       ctx["signup.password"] (or ctx["signup.passwordClear"], by convention).
 *  4) GeneratePasswordHashHandler
 *     - Derive hash + salt/params from the cleartext password.
 *     - Store on:
 *         ctx["signup.hash"]
 *         ctx["signup.hashAlgo"]
 *         ctx["signup.hashParamsJson"]
 *         ctx["signup.passwordCreatedAt"]
 *  5) CallUserCreateHandler
 *     - Use the hydrated DtoBag<UserDto> on ctx["bag"] to call the `user`
 *       service's create operation via SvcClient.call().
 *     - On success, ctx["bag"] MUST still be a DtoBag<UserDto> so finalize()
 *       can return the user profile to the client.
 *     - Stamps ctx["signup.userCreateStatus"] with { ok: true/false, ... }.
 *  6) CallUserAuthCreateHandler
 *     - Use ctx["signup.userId"] plus the hash metadata from step 4 to build
 *       a UserAuthDto via registry.newUserAuthDto() and its setters.
 *     - Wrap in a DtoBag<UserAuthDto> and call the `user-auth` worker's
 *       create operation via SvcClient.call().
 *     - Does NOT change ctx["bag"]; the edge response remains the UserDto bag.
 *     - Stamps ctx["signup.userAuthCreateStatus"] with { ok: true/false, ... }.
 *  7) MintUserAuthTokenHandler
 *     - If both user and user-auth create succeeded, mint a KMS-signed auth
 *       JWT and stash it on ctx["signup.jwt"] + timing fields so the
 *       controller/finalizer can surface it to the client.
 *     - On failure, does NOT roll back persistence; it switches the pipeline
 *       to error state and emits a Problem+JSON response.
 *  8) RollbackUserOnAuthCreateFailureHandler
 *     - If user.create succeeded but user-auth.create failed and the pipeline
 *       is in an error state, perform a compensating user.delete via S2S call
 *       to the user service and emit a Problem+JSON response that reflects the
 *       rollback outcome.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { CodeBuildUserIdHandler } from "./code.build.userId";
import { ToBagUserHandler } from "./toBag.User";
import { CodeExtractPasswordHandler } from "./code.extractPassword";
import { CodePasswordHashHandler } from "./code.passwordHash";
import { S2sUserCreateHandler } from "./s2s.user.create";
import { S2sUserAuthCreateHandler } from "./s2s.userAuth.create";
import { CodeMintUserAuthTokenHandler } from "./code.mintUserAuthToken";
import { S2sUserDeleteOnFailureHandler } from "./s2s.user.delete.onFailure";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // S2S metadata: used by handlers (or future policy gates) if needed.
  ctx.set("s2s.slug.user", "user");
  ctx.set("s2s.version.user", "v1");
  ctx.set("s2s.slug.userAuth", "user-auth");
  ctx.set("s2s.version.userAuth", "v1");

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
