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
 *   - ADR-0080 (SvcRuntime — Transport-Agnostic Service Runtime)
 *
 * Status:
 * - SvcRuntime Refactored (ADR-0080)
 *
 * Purpose:
 * - Populate a DtoBag from a wire bag envelope (one or many).
 * - Hydrates DTOs via Registry.resolveCtorByType(type).fromBody(json, { validate }).
 * - Sets instance collectionName on each DTO using Registry.dbCollectionNameByType(type).
 *
 * Invariants:
 * - Edges are bag-only (payload { items:[{ type:"<dtoType>", ...}] } ).
 * - Handler never builds wire responses; it only sets ctx["bag"] on success.
 * - On error, uses failWithError() (no response.status / response.body writes).
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import type { IDtoRegistry } from "../../registry/RegistryBase";
import { BagBuilder } from "../../dto/wire/BagBuilder";

export class ToBagHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "toBag";
  }

  protected handlerPurpose(): string {
    return "Populate a DtoBag from a wire bag envelope.";
  }

  protected async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    const body = this.safeCtxGet<any>("body") ?? {};
    const routeDtoType = this.safeCtxGet<string>("dtoType");
    const validate = true;

    if (!routeDtoType) {
      this.failWithError({
        httpStatus: 400,
        title: "missing_dto_type",
        detail: "Missing required path parameter ':dtoType'.",
        stage: "toBag:validate.dtoType",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage: "toBag: missing dtoType on route.",
        logLevel: "warn",
      });
      return;
    }

    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_body",
        detail:
          "Body must be a bag envelope: { items: [ { type: string, doc?: {...} | <inline fields> } ], meta?: {...} }",
        stage: "toBag:validate.items",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage: "toBag: empty or missing items[].",
        logLevel: "warn",
      });
      return;
    }

    const registry: IDtoRegistry = this.controller.getDtoRegistry();
    const coll = registry.dbCollectionNameByType(routeDtoType);
    const ctor = registry.resolveCtorByType(routeDtoType);

    const dtos: any[] = [];

    for (const w of items) {
      const wType = w?.type;
      if (wType !== routeDtoType) {
        this.failWithError({
          httpStatus: 400,
          title: "type_mismatch",
          detail: `Bag item type '${wType}' does not match route dtoType '${routeDtoType}'.`,
          stage: "toBag:validate.type_match",
          requestId,
          rawError: null,
          origin: { file: __filename, method: "execute" },
          issues: [{ wireType: wType, routeDtoType }],
          logMessage: "toBag: wire item type does not match route dtoType.",
          logLevel: "warn",
        });
        return;
      }

      // Support legacy `{ doc:{...} }` and new inline `{ ... }`
      const raw =
        (w && typeof w === "object" && "doc" in w ? (w as any).doc : w) ?? {};
      const json: Record<string, unknown> = {
        ...(raw as Record<string, unknown>),
      };

      // Normalize alias key: `${dtoType}Id` → `id` (only if `id` not already present)
      const aliasKey = `${routeDtoType}Id`;
      if (
        (json as any).id == null &&
        typeof (json as any)[aliasKey] === "string" &&
        String((json as any)[aliasKey]).trim()
      ) {
        (json as any).id = String((json as any)[aliasKey]).trim();
      }

      const dto = ctor.fromBody(json, { mode: "wire", validate });

      if (typeof (dto as any).setCollectionName === "function") {
        (dto as any).setCollectionName(coll);
      }

      this.log.debug(
        {
          event: "hydrate_item",
          type: routeDtoType,
          wireId: (json as any)?.id ?? (json as any)?.[aliasKey] ?? "(none)",
          requestId,
        },
        "toBag: wire→dto trace"
      );

      dtos.push(dto);
    }

    const { bag } = BagBuilder.fromDtos(dtos, {
      requestId: requestId ?? "unknown",
      limit: dtos.length,
      cursor: null,
      total: dtos.length,
      ...(body?.meta ? body.meta : {}),
    });

    this.ctx.set("bag", bag);
    this.ctx.set("handlerStatus", "ok");

    this.log.debug(
      {
        event: "bag_populated",
        items: dtos.length,
        dtoType: routeDtoType,
        requestId,
      },
      "toBag: DtoBag created from wire envelope"
    );
  }
}
