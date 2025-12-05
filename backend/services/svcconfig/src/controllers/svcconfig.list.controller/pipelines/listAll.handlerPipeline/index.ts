// backend/services/svcconfig/src/controllers/svcconfig.list.controller/pipelines/svcconfig.mirror.handlerPipeline/index.ts
/**
 * Docs:
 * - Inherit controller docs (SOP + ADRs)
 *
 * Purpose:
 * - Define ordered handler steps for dtoType "svcconfig" MIRROR.
 * - Mirror is a specialized LIST for the gateway:
 *   - Uses a server-controlled filter (no client query params).
 *   - Reuses the shared DbReadListHandler to read a deterministic batch.
 */

import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";

import { SvcconfigDto } from "@nv/shared/dto/svcconfig.dto";
import { ListAllFilterHandler } from "./listAllFilter.list.handler";
import { DbReadListHandler } from "@nv/shared/http/handlers/db.read.list";

export function getSteps(ctx: HandlerContext, controller: ControllerJsonBase) {
  // Seed DTO ctor used by handlers (same as LIST)
  ctx.set("list.dtoCtor", SvcconfigDto);

  return [
    // ListAll-specific, controller-local handler
    new ListAllFilterHandler(ctx, controller),
    // Shared cross-service list reader
    new DbReadListHandler(ctx, controller),
  ];
}
