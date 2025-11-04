// backend/services/t_entity_crud/src/controllers/xxx.create.controller/handlers/bagRequireSingleton.create.handler.ts
/**
 * Docs:
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Enforce that the inbound DtoBag contains exactly one item for create.
 * - On success: expose the DTO as ctx.set("dto", <XxxDto>).
 * - On failure: set handlerStatus="error", status=400 with Ops-friendly detail.
 *
 * Inputs (ctx):
 * - "bag": DtoBag<IDto> (set by BagPopulateGetHandler)
 *
 * Outputs (ctx):
 * - "dto": XxxDto (or concrete DTO matching the item.type)
 */

import { HandlerBase } from "@nv/shared/http/handlers/HandlerBase";
import { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";
import type { DtoBag } from "@nv/shared/dto/DtoBag";
import type { IDto } from "@nv/shared/dto/IDto";

export class BagRequireSingletonCreateHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const bag = this.ctx.get<DtoBag<IDto>>("bag");

    if (!bag) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "BAG_MISSING",
        title: "Bad Request",
        detail:
          'Missing items. Provide a JSON body with { items: [ { type: "xxx", ... } ] }.',
      });
      return;
    }

    // DtoBag exposes an iterator; get the first and check size cheaply.
    const it = bag.items();
    const first = it.next();
    if (first.done === true) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "EMPTY_ITEMS",
        title: "Bad Request",
        detail: "Create requires exactly one item; received 0.",
      });
      return;
    }
    const second = it.next();
    if (second.done !== true) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("status", 400);
      this.ctx.set("error", {
        code: "TOO_MANY_ITEMS",
        title: "Bad Request",
        detail: "Create requires exactly one item; received more than 1.",
      });
      return;
    }

    // Success: surface the hydrated DTO for the next handler.
    this.ctx.set("dto", first.value as IDto);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "singleton_ok",
        dtoType: (first.value as any)?.type ?? "<unknown>",
      },
      "BagRequireSingletonCreateHandler"
    );
  }
}
