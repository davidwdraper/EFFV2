// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "user" SIGNUP.
 * - Auth acts as a MOS: it coordinates User + UserAuth, instead of owning its own DTO.
 *
 * Current Flow (MOS v1, with outbound S2S):
 *  1) HydrateUserBagHandler
 *     - Validate wire bag envelope; hydrate UserDto via Registry;
 *       put DtoBag<UserDto> on ctx["bag"].
 *  2) ExtractPasswordHandler
 *     - Read password from header; validate; stash safely on
 *       ctx["signup.password"] (or ctx["signup.passwordClear"], by convention).
 *  3) GeneratePasswordHashHandler
 *     - Derive hash + salt/params from the cleartext password.
 *     - Store on:
 *         ctx["signup.hash"]
 *         ctx["signup.hashAlgo"]
 *         ctx["signup.hashParamsJson"]
 *         ctx["signup.passwordCreatedAt"]
 *  4) CallUserCreateHandler
 *     - Use the hydrated DtoBag<UserDto> on ctx["bag"] to call the `user`
 *       service's create operation via SvcClient.call().
 *     - On success, ctx["bag"] MUST still be a DtoBag<UserDto> so finalize()
 *       can return the user profile to the client.
 *  5) CallUserAuthCreateHandler
 *     - Use ctx["signup.userId"] (or id from the created UserDto bag) plus the
 *       hash metadata from step 3 to build a UserAuthDto via
 *       registry.newUserAuthDto() and its setters.
 *     - Wrap in a DtoBag<UserAuthDto> and call the `user-auth` worker's
 *       create operation via SvcClient.call().
 *     - Does NOT change ctx["bag"]; the edge response remains the UserDto bag.
 *
 * Future Flow (partial failure semantics):
 *  - If user-auth.create fails after user.create succeeds, future ADR will add a
 *    compensating delete on the user record and loud WAL/audit logs.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { HydrateUserBagHandler } from "./hydrateUserBag.handler";
import { ExtractPasswordHandler } from "./extractPassword.handler";
import { GeneratePasswordHashHandler } from "./generatePasswordHash.handler";
import { CallUserCreateHandler } from "./callUserCreate.handler";
import { CallUserAuthCreateHandler } from "./callUserAuthCreate.handler";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // S2S metadata: used by handlers (or future policy gates) if needed.
  ctx.set("s2s.slug.user", "user");
  ctx.set("s2s.version.user", "v1");
  ctx.set("s2s.slug.userAuth", "user-auth");
  ctx.set("s2s.version.userAuth", "v1");

  return [
    new HydrateUserBagHandler(ctx, controller),
    new ExtractPasswordHandler(ctx, controller),
    new GeneratePasswordHashHandler(ctx, controller),
    new CallUserCreateHandler(ctx, controller),
    new CallUserAuthCreateHandler(ctx, controller),
  ];
}
