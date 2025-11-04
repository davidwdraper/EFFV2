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
 * - Optional enforcement:
 *   • requireSingleton → exactly one item (400 if not), then seal bag (capacity=1).
 *   • enforceLimitFromMeta → validates bag size <= meta.limit (400 if overflow).
 *
 * Contract:
 * - ALWAYS sets ctx.set("bag", DtoBag).
 * - ALSO sets ctx.set("bagMeta", BagMeta) when body has meta; never stores meta on the bag.
 * - In singleton mode, also sets ctx.set("dto", IDto) for convenience.
 *
 * Policy (ctx):
 *   this.ctx.set("bagPolicy", {
 *     requireSingleton?: boolean,        // typical for create/update
 *     enforceLimitFromMeta?: boolean     // opt-in: treat meta.limit as binding
 *   })
 *   // Legacy flag still honored:
 *   this.ctx.set("requireSingleton", true)
 *
 * Inputs (ctx):
 * - "registry": IServiceRegistry (required)
 * - "requestId" | CtxKeys.RequestId: string (optional)
 * - "body" | CtxKeys.Body: any (optional)
 *
 * Outputs (ctx):
 * - "bag": DtoBag
 * - "bagMeta": BagMeta (if provided in body)
 * - "dto": IDto (only when requireSingleton passes)
 * - On violation: "handlerStatus"="error", "status"=400, "error"={ code,title,detail }
 */

import { HandlerBase } from "./HandlerBase";
import { HandlerContext, CtxKeys } from "./HandlerContext";
import { BagBuilder } from "../../dto/wire/BagBuilder";
import type { IServiceRegistry } from "../../registry/RegistryBase";
import type { IDto } from "../../dto/IDto";
import type { DtoBag } from "../../dto/DtoBag";
import type { BagMeta } from "../../dto/wire/BagMeta";

type BagPolicy = {
  requireSingleton?: boolean;
  enforceLimitFromMeta?: boolean;
};

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

    const policy: BagPolicy =
      this.ctx.get<BagPolicy>("bagPolicy") ?? ({} as BagPolicy);
    const legacyRequire =
      (this.ctx.get<boolean>("requireSingleton") as boolean | undefined) ??
      false;

    const requireSingleton = Boolean(policy.requireSingleton ?? legacyRequire);
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
      // Helpful lock: if cap===1 and we have exactly 1 item, seal it.
      if (
        cap === 1 &&
        size === 1 &&
        typeof (bag as any).sealSingleton === "function"
      ) {
        (bag as any).sealSingleton();
      }
    }

    // Strict singleton (create/update): exact size==1 and sealed.
    if (requireSingleton) {
      if (!hasItems) {
        return this._badRequest(
          "BAG_MISSING",
          'Missing items. Provide a JSON body with { items: [ { type: "xxx", ... } ] }.'
        );
      }
      if (size === 0) {
        return this._badRequest(
          "EMPTY_ITEMS",
          "Create/Update requires exactly one item; received 0."
        );
      }
      if (size !== 1) {
        return this._badRequest(
          "TOO_MANY_ITEMS",
          "Create/Update requires exactly one item; received more than 1."
        );
      }

      // Seal (capacity=1) at runtime — durable intent lives in meta.limit if present.
      if (typeof (bag as any).sealSingleton === "function") {
        (bag as any).sealSingleton();
      }

      const first =
        (bag as any).items?.[0] ??
        (() => {
          const it = (bag as any).items?.[Symbol.iterator]?.();
          const r = it ? it.next() : { done: true, value: undefined };
          return r && !r.done ? r.value : undefined;
        })();

      this.ctx.set("dto", first as IDto);
      this.ctx.set("handlerStatus", "ok");

      this.log.debug(
        {
          event: "bag_populated_singleton_ok",
          size,
          limit: meta?.limit ?? null,
          dtoType: (first as any)?.type ?? "<unknown>",
          requestId,
        },
        "BagPopulateGetHandler"
      );
      return;
    }

    // Non-singleton: just report population
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
