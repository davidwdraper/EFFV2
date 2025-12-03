// backend/services/auth/src/controllers/auth.signup.controller/pipelines/signup.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "user" SIGNUP.
 * - Auth acts as a MOS: it coordinates User + UserAuth, instead of owning its own DTO.
 *
 * Current Flow (no outbound S2S yet):
 *  1) HydrateUserBagHandler   → validate wire bag envelope; hydrate UserDto via Registry; put DtoBag<UserDto> on ctx["bag"].
 *  2) ExtractPasswordHandler  → read password from header; validate; stash safely on ctx["signup.password"].
 *  3) MockSuccessHandler      → temporary terminal stub; returns 200 using the UserDto bag.
 *
 * Future Flow:
 *  - After step 2:
 *    • S2S: call User service to create user using ctx["bag"] (UserDto bag).
 *    • Build UserAuthDto from ctx["signup.password"] + created userId.
 *    • S2S: call User-Auth service to persist credentials.
 *    • On partial success: compensating delete on user + loud logs for Ops.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { HydrateUserBagHandler } from "./hydrateUserBag.handler";
import { ExtractPasswordHandler } from "./extractPassword.handler";
import { MockSuccessHandler } from "./mockSuccess.handler";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // S2S metadata placeholders — real signup flow will use these.
  ctx.set("s2s.slug.user", "user");
  ctx.set("s2s.version.user", "v1");
  ctx.set("s2s.slug.userAuth", "user-auth");
  ctx.set("s2s.version.userAuth", "v1");

  return [
    new HydrateUserBagHandler(ctx, controller),
    new ExtractPasswordHandler(ctx, controller),
    new MockSuccessHandler(ctx, controller),
  ];
}
