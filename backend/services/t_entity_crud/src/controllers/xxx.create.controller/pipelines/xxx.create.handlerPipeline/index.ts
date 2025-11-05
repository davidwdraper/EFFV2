// backend/services/t_entity_crud/src/controllers/xxx.create.controller/pipelines/xxx.create.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "xxx" CREATE.
 * - Controller stays thin; *this* module owns orchestration (order only).
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/ControllerBase";

// Reuse your existing handlers (single-handler example is fine)
import { BagPopulateGetHandler } from "@nv/shared/http/handlers/bag.populate.get.handler";
import { BagToDbCreateHandler } from "./handlers/bagToDb.create.handler";

// If you later need different steps per dtoType, this file is where you change the order.
export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  return [
    // 1) Hydrate a DtoBag<IDto> from the JSON body (shared handler)
    new BagPopulateGetHandler(ctx, controller),
    // 2) Enforce single-item create and write to DB
    new BagToDbCreateHandler(ctx, controller),
  ];
}

/**
 * Future pattern for a new dtoType (create a sibling folder with matching surface):
 *
 *   // ./pipelines/myNewDto.create.handlerPipeline/index.ts
 *   import { SomeOtherHandler } from "../../handlers/someOther.create.handler";
 *   export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
 *     return [ new SomeOtherHandler(ctx, controller) ];
 *   }
 *
 * Then in the controller:
 *   import * as MyNewDtoCreatePipeline from "./pipelines/myNewDto.create.handlerPipeline";
 *   case "myNewDto": {
 *     const steps = MyNewDtoCreatePipeline.getSteps(ctx, this);
 *     await this.runPipeline(ctx, steps, { requireRegistry: true });
 *     break;
 *   }
 */
