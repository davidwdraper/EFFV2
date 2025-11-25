// backend/services/shared/src/http/handlers/bag.populate.get.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0043 (Finalize mapping; controller builds wire payload)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta; canonical id="id")
 *
 * Purpose:
 * - Populate a DtoBag from a wire bag envelope (one or many).
 * - Hydrates DTOs via Registry.resolveCtorByType(type).fromJson(json, { validate }).
 * - Sets instance collectionName on each DTO using Registry.dbCollectionNameByType(type).
 *
 * Invariants:
 * - Edges are bag-only (payload { items:[{ type:"<dtoType>", ...}] } ).
 * - Handler never builds wire responses; it only sets ctx["bag"] on success.
 * - On error, sets:
 *     handlerStatus = "error"
 *     response.status = <httpStatus>
 *     response.body   = Problem+JSON-like object
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import type { IDtoRegistry } from "../../registry/RegistryBase";
import { BagBuilder } from "../../dto/wire/BagBuilder";

export class BagPopulateGetHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const body = this.ctx.get<any>("body") ?? {};
    const routeDtoType = this.ctx.get<string>("dtoType");
    const validate = true;

    if (!routeDtoType) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':dtoType'.",
        requestId: this.ctx.get("requestId"),
      });
      this.log.warn(
        { event: "bad_request", reason: "no_dtoType" },
        "bag.populate — missing dtoType on route"
      );
      return;
    }

    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      this.ctx.set("handlerStatus", "error");
      this.ctx.set("response.status", 400);
      this.ctx.set("response.body", {
        code: "BAD_REQUEST_BODY",
        title: "Bad Request",
        detail:
          "Body must be a bag envelope: { items: [ { type: string, doc?: {...} | <inline fields> } ], meta?: {...} }",
        requestId: this.ctx.get("requestId"),
      });
      this.log.warn(
        { event: "bad_request", reason: "empty_items" },
        "bag.populate — empty or missing items[]"
      );
      return;
    }

    const registry: IDtoRegistry = this.controller.getDtoRegistry();
    const coll = registry.dbCollectionNameByType(routeDtoType);
    const ctor = registry.resolveCtorByType(routeDtoType);

    const dtos: any[] = [];
    for (const w of items) {
      const wType = w?.type;
      if (wType !== routeDtoType) {
        this.ctx.set("handlerStatus", "error");
        this.ctx.set("response.status", 400);
        this.ctx.set("response.body", {
          code: "TYPE_MISMATCH",
          title: "Bad Request",
          detail: `Bag item type '${wType}' does not match route dtoType '${routeDtoType}'.`,
          requestId: this.ctx.get("requestId"),
        });
        this.log.warn(
          { event: "type_mismatch", wType, routeDtoType },
          "bag.populate — wire type does not match route dtoType"
        );
        return;
      }

      // Support legacy `{ doc:{...} }` and new inline `{ ... }`
      const raw =
        (w && typeof w === "object" && "doc" in w ? (w as any).doc : w) ?? {};
      const json: Record<string, unknown> = {
        ...(raw as Record<string, unknown>),
      };

      // Normalize alias key: `${dtoType}Id` → `id` (only if `id` not already present)
      // Example: "userId" -> "id"
      const aliasKey = `${routeDtoType}Id`;
      if (
        json.id == null &&
        typeof (json as any)[aliasKey] === "string" &&
        String((json as any)[aliasKey]).trim()
      ) {
        json.id = String((json as any)[aliasKey]).trim();
      }

      // Hydrate DTO from wire JSON
      const dto = ctor.fromJson(json, { mode: "wire", validate });
      if (typeof (dto as any).setCollectionName === "function") {
        (dto as any).setCollectionName(coll);
      }

      this.log.debug(
        {
          event: "hydrate_item",
          type: routeDtoType,
          wireId: (json as any)?.id ?? (json as any)?.[aliasKey] ?? "(none)",
        },
        "bag.populate: wire→dto trace"
      );

      dtos.push(dto);
    }

    // Build DtoBag and stash in ctx
    const { bag } = BagBuilder.fromDtos(dtos, {
      requestId: this.ctx.get("requestId") ?? "unknown",
      limit: dtos.length,
      cursor: null,
      total: dtos.length,
      ...(body?.meta ? body.meta : {}),
    });

    this.ctx.set("bag", bag);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      { event: "bag_populated", items: dtos.length, dtoType: routeDtoType },
      "bag.populate — DtoBag created from wire envelope"
    );
  }
}
