// backend/services/t_entity_crud/src/controllers/create/xxx.create.controller.ts
/**
 * Purpose: Per-route controller for PUT /api/xxx/v1/create (no-op stub).
 * Notes: Controllers orchestrate only; handlers will be added later.
 */
import type { RequestHandler } from "express";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { CtxKeys } from "@nv/shared/http/HandlerContext";

export class XxxCreateController extends ControllerBase {
  constructor() {
    super({ service: "t_entity_crud" });
  }
  public handle(): RequestHandler {
    return super.handle(async (ctx) => {
      ctx.set(CtxKeys.ErrStatus, 501);
      ctx.set(CtxKeys.ErrCode, "not_implemented");
      ctx.set(
        CtxKeys.ErrDetail,
        "Create Xxx is not implemented yet. Wire handlers next (validate → persist WAL-first → DB)."
      );
    });
  }
}
