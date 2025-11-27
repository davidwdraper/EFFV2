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
import type { ControllerBase } from "@nv/shared/base/controller/ControllerBase";

import { SvcconfigDto } from "@nv/shared/dto/svcconfig.dto";
import { MirrorFilterHandler } from "./mirrorFilter.list.handler";
import { DbReadListHandler } from "@nv/shared/http/handlers/dbRead.list.handler";

export function getSteps(ctx: HandlerContext, controller: ControllerBase) {
  // Seed DTO ctor used by handlers (same as LIST)
  ctx.set("list.dtoCtor", SvcconfigDto);

  return [
    // Mirror-specific, controller-local handler
    new MirrorFilterHandler(ctx, controller),
    // Shared cross-service list reader
    new DbReadListHandler(ctx, controller),
  ];
}
