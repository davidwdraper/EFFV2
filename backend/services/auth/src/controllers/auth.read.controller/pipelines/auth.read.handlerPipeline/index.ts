// backend/services/auth/src/controllers/auth.read.controller/pipelines/auth.read.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "auth" READ (by id).
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/ControllerBase";

import { AuthDto } from "@nv/shared/dto/auth.dto";
import { DbReadByIdGetHandler } from "@nv/shared/http/handlers/dbRead.byId.get.handler";
export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  // Seed required inputs for the read handler
  ctx.set("read.dtoCtor", AuthDto);

  return [new DbReadByIdGetHandler(ctx, controller)];
}

/**
 * Future pattern for a new dtoType (create a sibling folder with matching surface):
 *
 *   // ./pipelines/myNewDto.read.handlerPipeline/index.ts
 *   import { MyNewDto } from "@nv/shared/dto/my-new-dto.dto";
 *   import { DbReadGetHandler } from "../../handlers/dbRead.get.handler";
 *   export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
 *     ctx.set("read.dtoCtor", MyNewDto);
 *     return [ new DbReadGetHandler(ctx, controller) ];
 *   }
 */
