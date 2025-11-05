// backend/services/shared/src/http/handlers/bag.populate.get.handler.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0049 (DTO Registry & canonical id)
 *   - ADR-0050 (Wire Bag Envelope — items[] + meta)
 *   - ADR-0053 (Bag Purity & Wire Envelope Separation)
 *
 * Purpose:
 * - Shared preflight for controllers that accept client JSON.
 * - Hydrates a DtoBag from body { items: [...] } and surfaces BagMeta separately.
 *
 * Contract:
 * - ALWAYS sets ctx.set("bag", DtoBag).
 * - ALSO sets ctx.set("bagMeta", BagMeta) when body has meta; meta never lives on the bag.
 * - No DTO singletons: the framework uses DtoBag at all interfaces (no ctx.set("dto")).
 *
 * Policy (ctx):
 *   this.ctx.set("bagPolicy", {
 *     enforceLimitFromMeta?: boolean     // opt-in: treat meta.limit as binding (fail-fast)
 *   })
 *
 * Inputs (ctx):
 * - "requestId" | CtxKeys.RequestId: string (optional)
 * - "body" | CtxKeys.Body: any (optional)
 *
 * Outputs (ctx):
 * - "bag": DtoBag
 * - "bagMeta": BagMeta (if provided in body)
 * - On violation: "handlerStatus"="error", "status"=400, "error"={ code,title,detail }
 */

import { HandlerBase } from "./HandlerBase";
import { HandlerContext, CtxKeys } from "./HandlerContext";
import { BagBuilder } from "../../dto/wire/BagBuilder";
import type { IDto } from "../../dto/IDto";
import type { DtoBag } from "../../dto/DtoBag";
import type { BagMeta } from "../../dto/wire/BagMeta";

type BagPolicy = {
  enforceLimitFromMeta?: boolean;
};

export class BagPopulateGetHandler extends HandlerBase {
  constructor(ctx: HandlerContext, controller: any) {
    super(ctx, controller);
  }

  protected async execute(): Promise<void> {
    const registry = this.registry;

    const requestId =
      this.ctx.get<string>(CtxKeys.RequestId) ??
      this.ctx.get<string>("requestId") ??
      "unknown";

    const body = (this.ctx.get<any>(CtxKeys.Body) ??
      this.ctx.get<any>("body") ??
      {}) as any;

    const policy: BagPolicy =
      this.ctx.get<BagPolicy>("bagPolicy") ?? ({} as BagPolicy);
    const enforceLimitFromMeta = Boolean(policy.enforceLimitFromMeta ?? false);

    const hasItems =
      body && typeof body === "object" && Array.isArray(body.items);

    let bag: DtoBag<IDto>;
    let meta: BagMeta | undefined;
    let size = 0;

    if (hasItems) {
      const built = BagBuilder.fromWire(body, { registry, requestId });
      bag = built.bag as unknown as DtoBag<IDto>;
      meta = built.meta as BagMeta | undefined;
      size = (bag as any).items?.length ?? 0;
      this.ctx.set("bag", bag);
      if (meta) this.ctx.set("bagMeta", meta);
    } else {
      const built = BagBuilder.fromDtos([], { requestId });
      bag = built.bag as unknown as DtoBag<IDto>;
      size = 0;
      this.ctx.set("bag", bag);
      // no meta on empty build; keep ctx clean
    }

    // Optional: enforce capacity from meta.limit (NEVER trim; fail fast).
    if (enforceLimitFromMeta && meta && Number.isFinite(meta.limit)) {
      const cap = Math.max(0, Math.floor(meta.limit));
      if (size > cap) {
        return this._badRequest(
          "BAG_OVER_LIMIT",
          `Items exceed declared meta.limit (${cap}). Remove extras or increase limit.`
        );
      }
    }

    // No singleton shortcuts: we do NOT set ctx.set("dto", …) here.
    this.log.debug(
      {
        event: "bag_populated",
        size,
        limit: meta?.limit ?? null,
        hasMeta: Boolean(meta),
        requestId,
      },
      "BagPopulateGetHandler"
    );
  }

  private _badRequest(code: string, detail: string): void {
    this.ctx.set("handlerStatus", "error");
    this.ctx.set("status", 400);
    this.ctx.set("error", {
      code,
      title: "Bad Request",
      detail,
    });
    this.log.debug(
      { event: "bag_policy_violation", code },
      "BagPopulateGetHandler"
    );
  }
}
