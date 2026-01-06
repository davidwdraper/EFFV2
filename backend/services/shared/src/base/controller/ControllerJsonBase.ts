// backend/services/shared/src/base/controller/ControllerJsonBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Controller & Handler Architecture)
 *   - ADR-0042 (HandlerContext Bus)
 *   - ADR-0043 (DTO Hydration + Failure Propagation)
 *   - ADR-0049 (DTO Registry & Wire Discrimination)
 *   - ADR-0050 (Wire Bag Envelope; bag-only edges)
 *   - ADR-0069 (Multi-Format Controllers & DTO Body Semantics)
 *
 * Purpose:
 * - JSON wire-format controller base.
 * - Builds HTTP responses strictly from HandlerContext.
 * - Delegates finalize-error logging policy to ControllerExpressBase.
 *
 * Invariants:
 * - Success responses MUST come from ctx["bag"] (DtoBag-like).
 * - Errors MUST come from ctx["error"] or ctx["response.body"].
 * - No business logic. No policy. No guessing.
 */

import type { Response } from "express";
import { ControllerExpressBase } from "./ControllerExpressBase";
import type { HandlerContext } from "../../http/handlers/HandlerContext";
import type { NvHandlerError } from "../../http/handlers/handlerBaseExt/errorHelpers";

export abstract class ControllerJsonBase extends ControllerExpressBase {
  protected async finalize(ctx: HandlerContext): Promise<void> {
    const res = ctx.get<Response>("res");
    if (!res) {
      throw new Error(
        "ControllerJsonBase.finalize: missing Response in HandlerContext."
      );
    }

    const requestId = ctx.get<string>("requestId") ?? "unknown";
    const status =
      ctx.get<number>("status") ?? ctx.get<number>("response.status") ?? 200;

    if (ctx.get<string>("handlerStatus") === "error") {
      const error =
        ctx.get<NvHandlerError>("error") ??
        (ctx.get<unknown>("response.body") as NvHandlerError | undefined);

      const body = error ??
        ctx.get<unknown>("response.body") ?? {
          title: "internal_error",
          detail: "Handler failed without structured error.",
          requestId,
        };

      res.status(status).json(body);

      this.logFinalizeError({
        ctx,
        requestId,
        status,
        body,
        event: "json_finalize_error",
      });

      return;
    }

    const bag = ctx.get<any>("bag");
    if (!bag || typeof bag.toBody !== "function") {
      const body = {
        title: "missing_response_bag",
        detail:
          "Controller finalized without a ctx['bag'] that supports toBody(). " +
          "Handlers must store success results in a DtoBag-like object at ctx['bag'] " +
          "and the bag must implement toBody() for controller responses.",
        requestId,
      };

      res.status(500).json(body);

      this.logFinalizeError({
        ctx,
        requestId,
        status: 500,
        body,
        event: "json_finalize_missing_bag",
      });

      return;
    }

    const payload = bag.toBody();
    res.status(status).json(payload);

    this.log.debug(
      {
        event: "json_finalize_success",
        requestId,
        status,
        dtoType: (payload as any)?.meta?.dtoType,
        count: (payload as any)?.meta?.count,
      },
      "ControllerJsonBase finalized response"
    );
  }
}
