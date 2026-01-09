// backend/services/handler-test/src/controllers/handler-test.update.controller/pipelines/handler-test.update.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "handler-test" UPDATE.
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { ToBagHandler } from "@nv/shared/http/handlers/toBag";
import { DbReadExistingHandler } from "@nv/shared/http/handlers/db.readExisting";
import { CodePatchHandler } from "@nv/shared/http/handlers/code.patch";
import { DbUpdateHandler } from "@nv/shared/http/handlers/db.update";

// DTO ctor for downstream
import { HandlerTestDto } from "@nv/shared/dto/db.handler-test.dto";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // Seed DTO ctor for downstream handlers
  ctx.set("update.dtoCtor", HandlerTestDto);

  return [
    // 1) Hydrate DtoBag<IDto> from JSON body (no singleton shortcut)
    new ToBagHandler(ctx, controller),
    // 2) Persist updated singleton bag
    new DbUpdateHandler(ctx, controller),
  ];
}
