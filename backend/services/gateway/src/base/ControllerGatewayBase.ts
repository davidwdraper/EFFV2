// backend/services/gateway/src/base/ControllerGatewayBase.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0041 (Per-route controllers; single-purpose handlers)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *   - ADR-0069 (Multi-Format Controllers & DTO Body Semantics) // gateway opts OUT
 *   - ADR-0080 (SvcSandbox — Transport-Agnostic Service Runtime)
 *   - ADR-#### (AppBase Optional DTO Registry for Proxy Services)
 *
 * Purpose:
 * - Specialized controller base for the gateway edge.
 * - Gateway is a pure proxy: it cannot assume DTO shape, bag shape, or registry.
 * - Finalizes responses using raw ctx["response.status"] / ctx["response.body"]
 *   set by handlers (e.g., gateway proxy handlers).
 *
 * Invariants:
 * - Never reads ctx["bag"] or attempts DTO-based finalization.
 * - Never requires a DtoRegistry.
 * - Treats handler-provided response.* as canonical output.
 */

import type { Response } from "express";
import { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import type { HandlerContext } from "@nv/shared/http/handlers/HandlerContext";

export abstract class ControllerGatewayBase extends ControllerBase {
  /**
   * Gateway does not use DTOs and must not require the registry.
   */
  public override needsRegistry(): boolean {
    return false;
  }

  /**
   * Raw finalize:
   * - Reads status/body from ctx["response.*"].
   * - Writes them directly to the Express response.
   * - Does NOT depend on DtoBag or wire-bag semantics.
   */
  protected override async finalize(ctx: HandlerContext): Promise<void> {
    const requestId = ctx.get<string | undefined>("requestId");
    const res = ctx.get<Response | undefined>("res");

    if (!res) {
      this.log.error(
        { event: "gateway_finalize_missing_res", requestId },
        "ControllerGatewayBase.finalize missing Express Response"
      );
      return;
    }

    const statusFromCtx = ctx.get<number | undefined>("response.status");
    const body = ctx.get<unknown>("response.body");
    const status = typeof statusFromCtx === "number" ? statusFromCtx : 500;

    this.log.debug(
      {
        event: "gateway_finalize",
        requestId,
        status,
        hasBody: body !== undefined && body !== null,
      },
      "ControllerGatewayBase finalized response"
    );

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
