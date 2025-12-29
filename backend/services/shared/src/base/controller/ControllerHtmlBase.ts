// backend/services/shared/src/base/controller/ControllerHtmlBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Controller & Handler Architecture)
 *   - ADR-0042 (HandlerContext Bus)
 *   - ADR-0043 (Failure Propagation)
 *   - ADR-0069 (Multi-Format Controllers & DTO Body Semantics)
 *
 * Purpose:
 * - HTML wire-format controller base (Express adapter).
 * - Minimal: writes text/html from HandlerContext.
 *
 * Invariants:
 * - No business logic here.
 * - Error logging policy is centralized in ControllerExpressBase.
 * - HTML success payload must come from ctx["html"] OR ctx["response.body"] as string.
 */

import type { Response } from "express";
import { ControllerExpressBase } from "./ControllerExpressBase";
import type { HandlerContext } from "../../http/handlers/HandlerContext";
import type { NvHandlerError } from "../../http/handlers/handlerBaseExt/errorHelpers";

export abstract class ControllerHtmlBase extends ControllerExpressBase {
  /**
   * Finalize an HTML HTTP response.
   *
   * Flow:
   * 1) If ctx indicates error → emit JSON-ish error payload (still useful in dev).
   * 2) Else → require a string HTML body from ctx["html"] or ctx["response.body"].
   */
  protected async finalize(ctx: HandlerContext): Promise<void> {
    const res = ctx.get<Response>("res");
    if (!res) {
      throw new Error(
        "ControllerHtmlBase.finalize: missing Response in HandlerContext."
      );
    }

    const requestId = ctx.get<string>("requestId") ?? "unknown";
    const status =
      ctx.get<number>("status") ?? ctx.get<number>("response.status") ?? 200;

    // Error path
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

      // Keep it explicit: errors are JSON (even for HTML controllers).
      res.status(status).json(body);

      this.logFinalizeError({
        ctx,
        requestId,
        status,
        body,
        event: "html_finalize_error",
      });

      return;
    }

    // Success path
    const html =
      ctx.get<string | undefined>("html") ??
      (ctx.get<unknown>("response.body") as string | undefined);

    if (typeof html !== "string" || !html.trim()) {
      const body = {
        title: "missing_html_body",
        detail:
          "ControllerHtmlBase finalized without a string HTML body. Dev: set ctx['html'] to a non-empty string.",
        requestId,
      };

      res.status(500).json(body);

      this.logFinalizeError({
        ctx,
        requestId,
        status: 500,
        body,
        event: "html_finalize_missing_body",
      });

      return;
    }

    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);

    this.log.debug(
      { event: "html_finalize_success", requestId, status },
      "ControllerHtmlBase finalized response"
    );
  }
}
