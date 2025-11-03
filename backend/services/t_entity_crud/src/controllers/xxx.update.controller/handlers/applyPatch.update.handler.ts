// backend/services/t_entity_crud/src/controllers/xxx.update.controller/handlers/applyPatch.update.handler.ts
/**
 * Purpose:
 * - Apply a partial JSON body to the loaded DTO by delegating to DTO logic.
 * - No field peeking here; the DTO enforces schema and allowed keys.
 *
 * Inputs:
 * - "existing": XxxDto
 * - "body": Record<string, unknown>
 *
 * Outputs:
 * - "updated": XxxDto
 * - "dto": XxxDto   <-- set for downstream handlers (DbWriter expects 'dto')
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";

export class ApplyPatchUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const dto = this.ctx.get<XxxDto>("existing");
    if (!dto) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MISSING_EXISTING",
        message: "Existing DTO missing from context.",
        hint: "Ensure LoadExistingUpdateHandler ran and succeeded.",
      });
      return;
    }

    const body = (this.ctx.get("body") as Record<string, unknown>) ?? {};

    try {
      // Delegate all validation/field rules to the DTO itself.
      dto.patchFrom(body);
    } catch (e) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "DTO_VALIDATION_FAILED",
        message:
          "Patch rejected by DTO validation. Ops: verify field names and types against the DTO.",
        detail: (e as Error).message,
      });
      return;
    }

    // Downstream expects 'dto'; keep 'updated' for consistency
    this.ctx.set("updated", dto);
    this.ctx.set("dto", dto);

    this.ctx.set("handlerStatus", "ok");
    this.log.debug({ event: "patched" }, "DTO patched via XxxDto.patchFrom()");
  }
}
