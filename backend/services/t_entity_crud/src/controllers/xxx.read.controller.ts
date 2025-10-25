// backend/services/t_entity_crud/src/controllers/read/xxx.read.controller.ts
/**
 * Purpose: Per-route controller for GET /api/xxx/v1/:xxxId (no-op stub).
 */
import type { RequestHandler } from "express";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { CtxKeys } from "@nv/shared/http/HandlerContext";

export class XxxReadController extends ControllerBase {
  constructor() {
    super({ service: "t_entity_crud" });
  }
  public handle(): RequestHandler {
    return super.handle(async (ctx) => {
      ctx.set(CtxKeys.ErrStatus, 501);
      ctx.set(CtxKeys.ErrCode, "not_implemented");
      ctx.set(
        CtxKeys.ErrDetail,
        "Read Xxx is not implemented yet. Next: load by :xxxId and return dto.toJson()."
      );
    });
  }
}
