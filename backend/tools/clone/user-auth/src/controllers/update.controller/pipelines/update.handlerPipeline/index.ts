// backend/services/user-auth/src/controllers/user-auth.update.controller/pipelines/user-auth.update.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "user-auth" UPDATE.
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { ToBagHandler } from "@nv/shared/http/handlers/toBag";
import { DbReadExistingHandler } from "@nv/shared/http/handlers/db.readExisting";
import { CodePatchHandler } from "@nv/shared/http/handlers/code.patch";
import { DbUpdateHandler } from "@nv/shared/http/handlers/db.update";

// DTO ctor for downstream
import { UserAuthDto } from "@nv/shared/dto/user-auth.dto";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // Seed DTO ctor for downstream handlers
  ctx.set("update.dtoCtor", UserAuthDto);

  return [
    // 1) Hydrate DtoBag<IDto> from JSON body (no singleton shortcut)
    new ToBagHandler(ctx, controller),
    // 2) Load the existing DTO as a **bag** (ctx["existingBag"])
    new DbReadExistingHandler(ctx, controller),
    // 3) Apply patch using inbound patch bag → UPDATED singleton bag into ctx["bag"]
    new CodePatchHandler(ctx, controller),
    // 4) Persist updated singleton bag
    new DbUpdateHandler(ctx, controller),
  ];
}
