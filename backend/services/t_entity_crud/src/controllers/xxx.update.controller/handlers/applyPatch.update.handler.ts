// backend/services/t_entity_crud/src/controllers/xxx.update.controller/handlers/applyPatch.update.handler.ts
/**
 * Docs:
 * - ADR-0041/0042 (Handlers, Context Bus)
 * - ADR-0048 (Revised — all reads return DtoBag)
 * - ADR-0050 (Wire Bag Envelope; singleton inbound)
 * - ADR-0053 (Bag Purity; bag-centric processing)
 *
 * Purpose:
 * - Patch the **existing** entity (from ctx["existingBag"]) using the client **patch**
 *   payload (from ctx["bag"]) — both are **singleton DtoBags**.
 * - Output a **singleton DtoBag** containing the UPDATED DTO and replace ctx["bag"] with it.
 *
 * Inputs (ctx):
 * - "existingBag": DtoBag<XxxDto>   (singleton; from LoadExistingUpdateHandler)
 * - "bag": DtoBag<IDto>             (singleton; from BagPopulateGetHandler — the patch)
 *
 * Outputs (ctx):
 * - "bag": DtoBag<XxxDto>           (REPLACED with updated singleton bag)
 * - "handlerStatus": "ok" | "error"
 * - "status": number
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
    // ---- Fetch bags ---------------------------------------------------------
    const existingBag = this.ctx.get<DtoBag<IDto>>("existingBag");
    const patchBag = this.ctx.get<DtoBag<IDto>>("bag");

    if (!existingBag || !patchBag) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "BAGS_MISSING",
        message:
          "Required bags not found on context. Ops: ensure LoadExistingUpdateHandler set 'existingBag' and BagPopulateGetHandler set 'bag'.",
      });
      return;
    }

    const existingItems = Array.from(existingBag.items());
    const patchItems = Array.from(patchBag.items());

    // ---- Enforce singleton semantics on both inputs -------------------------
    if (existingItems.length !== 1) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", existingItems.length === 0 ? 404 : 500);
      this.ctx.set("error", {
        code: existingItems.length === 0 ? "NOT_FOUND" : "MULTIPLE_MATCHES",
        message:
          existingItems.length === 0
            ? "No existing record found for supplied id."
            : "Invariant breach: multiple records matched primary key lookup.",
      });
      return;
    }

    if (patchItems.length !== 1) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: patchItems.length === 0 ? "EMPTY_ITEMS" : "TOO_MANY_ITEMS",
        message:
          patchItems.length === 0
            ? "Update requires exactly one patch item; received 0."
            : "Update requires exactly one patch item; received more than 1.",
      });
      return;
    }

    const existing = existingItems[0] as XxxDto;
    const patchDto = patchItems[0] as XxxDto;

    // ---- Apply patch via DTO authority -------------------------------------
    try {
      const patchJson = patchDto.toJson() as Record<string, unknown>;
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

    // ---- Re-bag the UPDATED DTO; replace ctx["bag"] -------------------------
    const { bag: updatedBag } = BagBuilder.fromDtos([existing], {
      requestId: this.ctx.get("requestId") ?? "unknown",
      limit: 1,
      cursor: null,
      total: 1,
    });
    (updatedBag as any)?.sealSingleton?.(); // no harm if not implemented

    this.ctx.set("bag", updatedBag);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      { event: "patched", singleton: true },
      "Existing DTO patched from patch bag and re-bagged"
    );
  }
}
