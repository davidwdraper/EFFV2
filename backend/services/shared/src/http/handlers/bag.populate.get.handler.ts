// backend/services/shared/src/http/handlers/bag.populate.get.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *
 * Purpose:
 * - Shared GET preflight. Hydrates a DtoBag from the request payload (if present)
 *   so downstream handlers operate on a consistent bag-based shape.
 *
 * Behavior:
 * - Reads optional JSON body with shape { items: [...] } (bag envelope) from ctx.
 * - If body is absent/invalid, seeds an empty bag with meta.requestId for traceability.
 *
 * Invariants:
 * - No business logic and no I/O here.
 * - Dependencies must be provided via HandlerContext under key "registry"
 *   and MUST implement IServiceRegistry (concrete per-service Registry is fine).
 * - Input keys read from ctx: requestId, body (see CtxKeys).
 * - Output: ctx.set("bag", DtoBag)
 */

import { HandlerBase } from "./HandlerBase";
import { HandlerContext, CtxKeys } from "./HandlerContext";
import { BagBuilder } from "../../dto/wire/BagBuilder";
import type { IServiceRegistry } from "../../registry/RegistryBase";

export class BagPopulateGetHandler extends HandlerBase {
  constructor(ctx: HandlerContext) {
    super(ctx);
  }

  protected async execute(): Promise<void> {
    const registry = this.ctx.get<IServiceRegistry>("registry");
    if (!registry) {
      throw new Error(
        "IServiceRegistry not found in context (key: 'registry'). " +
          "Controller must seed ctx.set('registry', <IServiceRegistry>)."
      );
    }

    const requestId =
      this.ctx.get<string>(CtxKeys.RequestId) ??
      this.ctx.get<string>("requestId") ??
      "unknown";

    const body = (this.ctx.get<any>(CtxKeys.Body) ??
      this.ctx.get<any>("body") ??
      {}) as any;

    const hasItems =
      body && typeof body === "object" && Array.isArray(body.items);

    let bagSize = 0;

    if (hasItems) {
      const { bag /* , meta */ } = BagBuilder.fromWire(body, {
        registry,
        requestId,
      });
      bagSize = bag.items.length;
      this.ctx.set("bag", bag);
    } else {
      const { bag /* , meta */ } = BagBuilder.fromDtos([], { requestId });
      bagSize = 0;
      this.ctx.set("bag", bag);
    }

    this.log.debug(
      {
        event: "bag_populated",
        size: bagSize,
        hasMeta: true, // BagBuilder always returns a meta
        requestId,
      },
      "BagPopulateGetHandler"
    );
  }
}
