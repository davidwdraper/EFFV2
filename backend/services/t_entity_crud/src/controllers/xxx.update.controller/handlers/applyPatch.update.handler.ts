// backend/services/t_entity_crud/src/controllers/xxx.update.controller/handlers/applyPatch.update.handler.ts
/**
 * Docs:
 * - ADR-0041/0042 (Handlers, Context Bus)
 * - ADR-0050 (Wire Bag Envelope; singleton inbound)
 * - ADR-0053 (Bag Purity; bag-centric processing)
 *
 * Purpose:
 * - Apply the inbound singleton DTO (from ctx["bag"]) onto the loaded "existing" DTO.
 * - Enforce DtoBag wrapper: output a **singleton bag** containing the UPDATED DTO.
 *
 * Inputs (ctx):
 * - "existing": XxxDto            (from LoadExistingUpdateHandler)
 * - "bag": DtoBag<IDto>           (singleton; from BagPopulateGetHandler)
 *
 * Outputs (ctx):
 * - "dto": XxxDto                 (convenience)
 * - "updated": XxxDto             (alias of dto)
 * - "bag": DtoBag<XxxDto>         (REPLACED with updated singleton bag)
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { IDto } from "@nv/shared/dto/IDto";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { XxxDto } from "@nv/shared/dto/templates/xxx/xxx.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";

export class ApplyPatchUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const existing = this.ctx.get<XxxDto>("existing");
    if (!existing) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "MISSING_EXISTING",
        message: "Existing DTO missing from context.",
        hint: "Ensure LoadExistingUpdateHandler ran and succeeded.",
      });
      return;
    }

    const inboundBag = this.ctx.get<DtoBag<IDto>>("bag");
    if (!inboundBag) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAG_MISSING",
        message: "Inbound DtoBag missing. Did BagPopulateGetHandler run?",
      });
      return;
    }

    // Must be singleton (policy enforced earlier). Guard anyway.
    const items = [...inboundBag.items()];
    if (items.length !== 1) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: items.length === 0 ? "EMPTY_ITEMS" : "TOO_MANY_ITEMS",
        message:
          items.length === 0
            ? "Update requires exactly one item; received 0."
            : "Update requires exactly one item; received more than 1.",
      });
      return;
    }

    const patchDto = items[0] as XxxDto;

    try {
      // Call toJson() directly (no pointless conditional).
      const patchJson = patchDto.toJson() as Record<string, unknown>;
      // Delegate patch rules to the DTO (immutability checks live there).
      existing.patchFrom(patchJson);
    } catch (e) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "DTO_VALIDATION_FAILED",
        message: "Patch rejected by DTO validation.",
        detail: (e as Error).message,
      });
      return;
    }

    // Re-wrap UPDATED DTO into a singleton bag (bag-centric invariant)
    const { bag: updatedBag } = BagBuilder.fromDtos([existing], {
      requestId: this.ctx.get("requestId") ?? "unknown",
    });
    // Optional: lock as singleton if available
    (updatedBag as any)?.sealSingleton?.();

    this.ctx.set("bag", updatedBag);
    this.ctx.set("updated", existing);
    this.ctx.set("dto", existing);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      { event: "patched", singleton: true },
      "DTO patched and re-bagged (singleton)"
    );
  }
}
