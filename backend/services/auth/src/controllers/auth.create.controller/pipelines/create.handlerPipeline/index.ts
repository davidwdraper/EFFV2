// backend/services/auth/src/controllers/auth.create.controller/pipelines/auth.create.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs).
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "auth" CREATE.
 * - Controller stays thin; this module owns orchestration (order + S2S targets).
 *
 * Flow (current round, no outbound S2S):
 *  1) CreateAuthDtoHandler         → validate wire bag envelope; hydrate AuthDto into ctx["authDto"].
 *  2) AuthCreateBagPopulateHandler → wrap AuthDto into singleton DtoBag on ctx["bag"].
 *  3) CallUserCreateHandler        → stub-success; verifies bag exists and marks handlerStatus="ok".
 *
 * Future:
 * - CallUserCreateHandler will be upgraded to perform a real SvcClient call to the User service.
 * - AuthToUserDtoMapperHandler remains available for future Auth→User mapping flows.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { CreateAuthDtoHandler } from "./createAuthDto.handler";
import { AuthCreateBagPopulateHandler } from "./createBagPopulate.handler";
import { CallUserCreateHandler } from "./callUserCreate.handler";
import { Mock200AuthCreateHandler } from "./mock-200.handler";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // Seed S2S target metadata for future real SvcClient call (user service v1).
  ctx.set("s2s.slug", "user");
  ctx.set("s2s.version", "v1");
  // Optionally, upstream can set "s2s.env" (e.g., from svcEnv) if needed later.

  return [
    // 1) Validate wire bag envelope + hydrate AuthDto from inbound payload via Registry.
    //new CreateAuthDtoHandler(ctx, controller),

    // 2) Build a singleton DtoBag<AuthDto> on ctx["bag"] for finalize().
    //ew AuthCreateBagPopulateHandler(ctx, controller),

    // 3) Terminal stub — ensure bag exists, mark success; no outbound S2S yet.
    //new CallUserCreateHandler(ctx, controller),

    new Mock200AuthCreateHandler(ctx, controller),
  ];
}
