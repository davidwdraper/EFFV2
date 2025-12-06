// backend/services/prompt/src/controllers/prompt.update.controller/pipelines/prompt.update.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "prompt" UPDATE.
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

// Shared preflight
import { ToBagHandler } from "@nv/shared/http/handlers/toBag";

// DTO ctor for downstream
import { PromptDto } from "@nv/shared/dto/prompt.dto";

// Update-specific handlers
import { DbReadExistingHandler } from "./db.readExisting";
import { CodePatchHandler } from "./code.patch";
import { DbUpdateHandler } from "./db.update";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // Seed DTO ctor for downstream handlers
  ctx.set("update.dtoCtor", PromptDto);

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
