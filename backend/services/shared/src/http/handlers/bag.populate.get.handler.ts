// backend/services/shared/src/http/handlers/bag.populate.get.handler.ts
/**
 * Docs:
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0049 (DTO Registry & wire discrimination)
 * - ADR-0050 (Wire Bag Envelope — bag-only edges)
 * - ADR-0053 (Bag Purity — no naked DTOs on the bus)
 *
 * Purpose:
 * - Parse request.body as a wire bag envelope and hydrate a DtoBag<IDto>.
 * - Validates basic shape and uses the Registry to build DTO instances.
 *
 * Inputs (ctx):
 * - "body": { items: Array<{ type: string, ...dtoJson }> , meta?: {...} }
 *
 * Outputs (ctx):
 * - "bag": DtoBag<IDto>
 * - "handlerStatus": "ok" | "error"
 * - "response.status"/"response.body" on error
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import type { IDto } from "../../dto/IDto";
import { BagBuilder } from "../../dto/wire/BagBuilder";

export class BagPopulateGetHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const body = (this.ctx.get("body") as any) ?? {};

    // Shape check
    if (!body || typeof body !== "object" || !Array.isArray(body.items)) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST_BODY",
        title: "Bad Request",
        detail:
          "Body must be a bag envelope: { items: [ { type: string, ... } ], meta?: {...} }",
      });
      return;
    }

    // Registry from controller (strict)
    const registry = this.controller.getDtoRegistry();
    if (!registry || typeof registry.resolveCtorByType !== "function") {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 500);
      this.ctx.set("response.body", {
        code: "REGISTRY_MISSING",
        title: "Internal Error",
        detail:
          "DtoRegistry missing or does not implement resolveCtorByType().",
      });
      return;
    }

    const requestId =
      (this.ctx.get<string>("requestId") as string) || "unknown";
    const itemsWire = body.items as any[];

    // Hydrate via registry.fromWireItem (sets collection on instances)
    const dtos: IDto[] = [];
    try {
      for (const w of itemsWire) {
        if (
          !w ||
          typeof w !== "object" ||
          typeof (w as any).type !== "string"
        ) {
          throw new Error("wire item missing 'type'");
        }
        // Accept either {type, item:{...}} or {type, ...dtoJson}
        const wire = Object.prototype.hasOwnProperty.call(w, "item")
          ? w
          : { type: w.type, item: w };
        const dto = registry.fromWireItem(wire as any, { validate: true });
        dtos.push(dto);
      }
    } catch (e: any) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "WIRE_PARSE_FAILED",
        title: "Bad Request",
        detail: e?.message ?? String(e),
      });
      return;
    }

    // Build DtoBag + meta (no naked DTOs on the bus)
    const limit =
      typeof body?.meta?.limit === "number"
        ? body.meta.limit
        : dtos.length || 1;
    const { bag, meta } = BagBuilder.fromDtos(dtos, {
      requestId,
      limit,
      total: dtos.length,
      cursor: null,
    });

    // Optional policy: enforce limit from meta
    const policy = (this.ctx.get("bagPolicy") as any) ?? {};
    if (policy?.enforceLimitFromMeta === true && dtos.length > limit) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "LIMIT_EXCEEDED",
        title: "Bad Request",
        detail: `Item count ${dtos.length} exceeds meta.limit ${limit}.`,
      });
      return;
    }

    this.ctx.set("bag", bag);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      { event: "bag_populated", items: dtos.length, limit: meta.limit },
      "Bag populated from wire envelope"
    );
  }
}
