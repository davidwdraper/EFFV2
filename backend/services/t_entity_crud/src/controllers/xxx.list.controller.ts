// backend/services/t_entity_crud/src/controllers/list/xxx.list.controller.ts
/**
 * Purpose: Per-route controller for GET /api/xxx/v1/list (no-op stub).
 */
import type { RequestHandler } from "express";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import { CtxKeys } from "@nv/shared/http/HandlerContext";

export class XxxListController extends ControllerBase {
  constructor() {
    super({ service: "t_entity_crud" });
  }
  public handle(): RequestHandler {
    return super.handle(async (ctx) => {
      ctx.set(CtxKeys.ErrStatus, 501);
      ctx.set(CtxKeys.ErrCode, "not_implemented");
      ctx.set(
        CtxKeys.ErrDetail,
        "List Xxx is not implemented yet. Next: support limit/skip/sort via IDb QuerySpec."
      );
    });
  }
}
