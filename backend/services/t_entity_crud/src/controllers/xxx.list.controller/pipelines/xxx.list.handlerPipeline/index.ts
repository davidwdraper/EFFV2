// backend/services/t_entity_crud/src/controllers/xxx.list.controller/pipelines/xxx.list.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "xxx" LIST.
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { XxxDto } from "@nv/shared/dto/xxx.dto";
import { QueryListHandler } from "./handlers/query.list.handler";
import { DbReadListHandler } from "./handlers/dbRead.list.handler";

export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  // Seed DTO ctor used by handlers
  ctx.set("list.dtoCtor", XxxDto);

  return [
    new QueryListHandler(ctx, controller),
    new DbReadListHandler(ctx, controller),
  ];
}

/**
 * Future pattern for a new dtoType (create a sibling folder with matching surface):
 *
 *   // ./pipelines/myNewDto.list.handlerPipeline/index.ts
 *   import { MyNewDto } from "@nv/shared/dto/my-new-dto.dto";
 *   import { QueryListHandler } from "../../handlers/query.list.handler";
 *   import { DbReadListHandler } from "../../handlers/dbRead.list.handler";
 *
 *   export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
 *     ctx.set("list.dtoCtor", MyNewDto);
 *     return [ new QueryListHandler(ctx, controller), new DbReadListHandler(ctx, controller) ];
 *   }
 */
