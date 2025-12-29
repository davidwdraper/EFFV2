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
import { ToBagHandler } from "@nv/shared/http/handlers/toBag";

// DTO ctor for downstream
import { EnvServiceDto } from "@nv/shared/dto/env-service.dto";

// Update-specific handlers
import { DbReadExistingHandler } from "./db.readExisting";
import { CodePatchHandler } from "@nv/shared/http/handlers/code.patch";
import { DbUpdateHandler } from "./db.update";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // Seed DTO ctor for downstream handlers
  ctx.set("update.dtoCtor", EnvServiceDto);

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
