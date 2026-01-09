// backend/services/shared/src/http/handlers/toBag.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0047 (DtoBag, DtoBagView, and DB-Level Batching)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *   - ADR-0102 (Registry sole DTO creation authority)
 *   - ADR-0103 (DTO naming convention: keys)
 *
 * Purpose:
 * - Populate a DtoBag from a wire bag envelope using the Registry ONLY.
 *
 * Invariants:
 * - ctx["dtoKey"] is the registry key (ADR-0103), e.g. "db.user.dto"
 * - Wire envelope uses BagBuilder format:
 *     { items: [ { type: "<dtoKey>", item: <dto-json> } ], meta?: { ... } }
 * - No legacy `{ doc: ... }` wrapper support. Brand new backend.
 */

import { HandlerBase } from "./HandlerBase";
import type { HandlerContext } from "./HandlerContext";
import type { IDtoRegistry } from "../../registry/IDtoRegistry";
import { BagBuilder } from "../../dto/wire/BagBuilder";

export class ToBagHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  public override handlerName(): string {
    return "toBag";
  }

  protected handlerPurpose(): string {
    return "Populate a DtoBag from a wire bag envelope using registry-only hydration.";
  }

  protected async execute(): Promise<void> {
    const requestId = this.safeCtxGet<string>("requestId");

    const body = this.safeCtxGet<any>("body") ?? {};
    const dtoKey = (this.safeCtxGet<string>("dtoKey") ?? "").trim();

    if (!dtoKey) {
      this.failWithError({
        httpStatus: 400,
        title: "missing_dto_key",
        detail:
          "Missing required route dtoKey (expected ADR-0103 key like 'db.user.dto').",
        stage: "toBag:validate.dtoKey",
        requestId,
        rawError: null,
        origin: { file: __filename, method: "execute" },
        logMessage: "toBag: missing dtoKey on route/context.",
        logLevel: "warn",
      });
      return;
    }

    const registry: IDtoRegistry = this.controller.getDtoRegistry();

    let result: { bag: any; meta: any };
    try {
      result = BagBuilder.fromWire(body, {
        registry,
        requestId,
        allowEmpty: false,
      });
    } catch (err) {
      this.failWithError({
        httpStatus: 400,
        title: "bad_request_body",
        detail: (err as Error)?.message ?? "Invalid wire bag payload.",
        stage: "toBag:wire.parse",
        requestId,
        rawError: err,
        origin: { file: __filename, method: "execute" },
        logMessage: "toBag: failed to parse/hydrate wire bag payload.",
        logLevel: "warn",
      });
      return;
    }

    // Enforce route dtoKey matches every item.type.
    // BagBuilder already requires type; we enforce that it equals the route key.
    const items = Array.from(result.bag.items());
    for (let i = 0; i < items.length; i++) {
      const itemType = (items[i] as any)?.getType?.();
      if (itemType && itemType !== dtoKey) {
        this.failWithError({
          httpStatus: 400,
          title: "type_mismatch",
          detail: `Hydrated DTO type '${itemType}' does not match route dtoKey '${dtoKey}'.`,
          stage: "toBag:validate.type_match",
          requestId,
          rawError: null,
          origin: { file: __filename, method: "execute" },
          issues: [{ hydratedType: itemType, routeDtoKey: dtoKey }],
          logMessage: "toBag: hydrated DTO type does not match route dtoKey.",
          logLevel: "warn",
        });
        return;
      }
    }

    this.ctx.set("bag", result.bag);
    this.ctx.set("handlerStatus", "ok");
  }
}
