// backend/services/prompt/src/controllers/prompt.read.controller/pipelines/prompt.read.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "prompt" READ (by id).
 * - Pipeline seeds the DTO ctor into ctx; controller stays orchestration-light.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { PromptDto } from "@nv/shared/dto/prompt.dto";
import { DbReadByIdGetHandler } from "@nv/shared/http/handlers/dbRead.byId.get.handler";
export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  // Seed required inputs for the read handler
  ctx.set("read.dtoCtor", PromptDto);

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
