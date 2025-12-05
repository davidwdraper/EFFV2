// backend/services/env-service/src/controllers/update.controller/pipelines/update.pipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "env-service" UPDATE.
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

// Shared preflight
import { BagPopulateGetHandler } from "@nv/shared/http/handlers/toBag";

// DTO ctor for downstream
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

// Update-specific handlers
import { LoadExistingUpdateHandler } from "./loadExisting.handler";
import { ApplyPatchUpdateHandler } from "./applyPatch.handler";
import { BagToDbUpdateHandler } from "./bagToDb.handler";

export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  // Seed DTO ctor for downstream handlers
  ctx.set("update.dtoCtor", EnvServiceDto);

  return [
    // 1) Hydrate DtoBag<IDto> from JSON body (no singleton shortcut)
    new BagPopulateGetHandler(ctx, controller),
    // 2) Load the existing DTO as a **bag** (ctx["existingBag"])
    new LoadExistingUpdateHandler(ctx, controller),
    // 3) Apply patch using inbound patch bag → UPDATED singleton bag into ctx["bag"]
    new ApplyPatchUpdateHandler(ctx, controller),
    // 4) Persist updated singleton bag
    new BagToDbUpdateHandler(ctx, controller),
  ];
}

/**
 * Future pattern for a new dtoType (create a sibling folder with matching surface):
 *
 *   // ./pipelines/myNewDto.update.handlerPipeline/index.ts
 *   import { MyNewDto } from "@nv/shared/dto/my-new-dto.dto";
 *   import { BagPopulateGetHandler } from "@nv/shared/http/handlers/bag.populate.get.handler";
 *   import { LoadExistingUpdateHandler } from "../../handlers/loadExisting.update.handler";
 *   import { ApplyPatchUpdateHandler } from "../../handlers/applyPatch.update.handler";
 *   import { BagToDbUpdateHandler } from "../../handlers/bagToDb.update.handler";
 *
 *   export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
 *     ctx.set("update.dtoCtor", MyNewDto);
 *     return [
 *       new BagPopulateGetHandler(ctx, controller),
 *       new LoadExistingUpdateHandler(ctx, controller),
 *       new ApplyPatchUpdateHandler(ctx, controller),
 *       new BagToDbUpdateHandler(ctx, controller),
 *     ];
 *   }
 */
