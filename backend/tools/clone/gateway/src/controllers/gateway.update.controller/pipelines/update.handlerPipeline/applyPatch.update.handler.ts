// backend/services/gateway/src/controllers/gateway.update.controller/handlers/applyPatch.update.handler.ts
/**
 * Docs:
 * - ADR-0041/0042 (Handlers, Context Bus)
 * - ADR-0048 (All reads return DtoBag)
 * - ADR-0050 (Wire Bag Envelope; singleton inbound)
 * - ADR-0053 (Bag Purity; bag-centric processing)
 *
 * Purpose:
 * - Patch the **existing** entity (from ctx["existingBag"]) using the client **patch**
 *   payload (from ctx["bag"]) — both are **singleton DtoBags<GatewayDto>**.
 * - Output a **singleton DtoBag<GatewayDto>** with the UPDATED DTO and replace ctx["bag"] with it.
 *
 * Inputs (ctx):
 * - "existingBag": DtoBag<GatewayDto>   (singleton; from LoadExistingUpdateHandler)
 * - "bag": DtoBag<GatewayDto>           (singleton; from BagPopulateGetHandler — the patch)
 *
 * Outputs (ctx):
 * - "bag": DtoBag<GatewayDto>           (REPLACED with updated singleton bag)
 * - "handlerStatus": "ok" | "error"
 * - "status": number
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import { GatewayDto } from "@nv/shared/dto/gateway.dto";
import { BagBuilder } from "@nv/shared/dto/wire/BagBuilder";
import type { IDto } from "@nv/shared/dto/IDto";
import type { IDtoRegistry } from "@nv/shared/registry/RegistryBase";

export class ApplyPatchUpdateHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    // ---- Fetch typed bags ---------------------------------------------------
    const existingBag = this.ctx.get<DtoBag<GatewayDto>>("existingBag");
    const patchBag = this.ctx.get<DtoBag<GatewayDto>>("bag");

    if (!existingBag || !patchBag) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 500);
      this.ctx.set("error", {
        code: "BAGS_MISSING",
        title: "Internal Error",
        detail:
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
        title: existingItems.length === 0 ? "Not Found" : "Internal Error",
        detail:
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
        title: "Bad Request",
        detail:
          patchItems.length === 0
            ? "Update requires exactly one patch item; received 0."
            : "Update requires exactly one patch item; received more than 1.",
      });
      return;
    }

    const existing = existingItems[0];
    const patchDto = patchItems[0];

    // ---- Runtime type sanity (hard fail if pipeline wiring is wrong) -------
    if (!(existing instanceof GatewayDto) || !(patchDto instanceof GatewayDto)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "TYPE_MISMATCH",
        title: "Bad Request",
        detail:
          "DtoBag type mismatch: expected GatewayDto for both existing and patch items.",
      });
      return;
    }

    // ---- Apply patch via DTO authority -------------------------------------
    try {
      const patchJson = patchDto.toJson() as Record<string, unknown>;
      existing.patchFrom(patchJson); // no options object
    } catch (e) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "DTO_VALIDATION_FAILED",
        title: "Bad Request",
        detail: (e as Error).message,
      });
      return;
    }

    // ---- Re-assert instance collection (prevents DTO_COLLECTION_UNSET) -----
    try {
      const dtoType = this.ctx.get<string>("dtoType"); // "gateway" on this route
      if (
        dtoType &&
        typeof (this.controller as any).getDtoRegistry === "function"
      ) {
        const reg: IDtoRegistry = (this.controller as any).getDtoRegistry();
        const coll = reg.dbCollectionNameByType(dtoType);
        if (coll && typeof (existing as any).setCollectionName === "function") {
          (existing as any).setCollectionName(coll);
        }
      }
    } catch {
      // non-fatal; DbWriter will enforce collection presence
    }

    // ---- Re-bag the UPDATED DTO; replace ctx["bag"] -------------------------
    const dtos: IDto[] = [existing as unknown as IDto];
    const { bag: updatedBag } = BagBuilder.fromDtos(dtos, {
      requestId: this.ctx.get("requestId") ?? "unknown",
      limit: 1,
      cursor: null,
      total: 1,
    });
    (updatedBag as any)?.sealSingleton?.(); // harmless if not implemented

    this.ctx.set("bag", updatedBag);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      { event: "patched", singleton: true },
      "Existing DTO patched from patch bag and re-bagged"
    );
  }
}
