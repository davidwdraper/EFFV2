// backend/services/gateway/src/base/ControllerGatewayBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire format)  // workers only
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *
 * Purpose:
 * - Specialized controller base for the gateway edge.
 * - Finalizes responses using raw ctx["response.status"] / ctx["response.body"]
 *   set by handlers (e.g., GatewayProxyS2sHandler).
 *
 * Invariants:
 * - Never reads ctx["bag"] or attempts DTO-based finalization.
 * - Never calls prompts or builds Problem+JSON automatically.
 * - Treats handler-provided response.* as canonical output.
 */

import type { Response } from "express";
import { ControllerJsonBase } from "@nv/shared/base/controller/ControllerJsonBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

export abstract class ControllerGatewayBase extends ControllerJsonBase {
  /**
   * Raw finalize:
   * - Reads status/body from ctx["response.*"].
   * - Writes them directly to the Express response.
   * - Does NOT depend on DtoBag or wire-bag semantics.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public override async finalize(ctx: HandlerContext): Promise<void> {
    const requestId = ctx.get<string | undefined>("requestId");
    const res = ctx.get<Response | undefined>("res");

    if (!res) {
      this.log.error("ControllerGatewayBase.finalize.missingResponse", {
        requestId,
      });
      return;
    }

    const statusFromCtx = ctx.get<number | undefined>("response.status");
    const body = ctx.get<unknown>("response.body");
    const status = typeof statusFromCtx === "number" ? statusFromCtx : 500;

    this.log.debug("ControllerGatewayBase.finalize", {
      requestId,
      status,
      hasBody: body !== undefined && body !== null,
    });

    res.status(status);

    if (body === undefined || body === null) {
      res.end();
      return;
    }

    // If the handler gave us a raw string/Buffer, send as-is.
    if (typeof body === "string" || (body as any) instanceof Buffer) {
      res.send(body as any);
      return;
    }

    // Otherwise, JSON-encode the payload.
    res.json(body as unknown);
  }
}
