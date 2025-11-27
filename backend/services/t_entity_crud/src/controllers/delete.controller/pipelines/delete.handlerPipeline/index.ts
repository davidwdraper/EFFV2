// backend/services/t_entity_crud/src/controllers/xxx.delete.controller/pipelines/xxx.delete.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "xxx" DELETE.
 * - Controller stays thin; this module owns orchestration (order only).
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

// Reuse existing handler; if you later relocate handlers under the pipeline folder,
// just adjust this import path.
import { DbDeleteDeleteHandler } from "./dbDelete.delete.handler";

export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  return [new DbDeleteDeleteHandler(ctx, controller)];
}

/**
 * Future pattern for a new dtoType (create a sibling folder with matching surface):
 *
 *   // ./pipelines/myNewDto.delete.handlerPipeline/index.ts
 *   import { MyNewDtoDeleteHandler } from "../../handlers/myNewDto.delete.handler";
 *   export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
 *     return [ new MyNewDtoDeleteHandler(ctx, controller) ];
 *   }
 *
 * Then in the controller:
 *   import * as MyNewDtoDeletePipeline from "./pipelines/myNewDto.delete.handlerPipeline";
 *   case "myNewDto": {
 *     const steps = MyNewDtoDeletePipeline.getSteps(ctx, this);
 *     await this.runPipeline(ctx, steps, { requireRegistry: true });
 *     break;
 *   }
 */
