// backend/services/shared/src/controllers/base.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Super controller base for all services.
 * - Centralizes envelope-aware request/response handling on top of SvcReceiver.
 * - Provides helpers to shape success/error envelopes and to pass upstream
 *   envelopes through unchanged (for S2S proxy-style endpoints).
 *
 * Design:
 * - Keep this generic (no service-specific logic).
 * - Child controllers call `this.rx.receive(...)` inside `handle(...)` and
 *   return the tuples produced by helpers here.
 */

import type { Request, Response } from "express";
import { SvcReceiver } from "../svc/SvcReceiver";
import type { SvcResponse } from "../svc/types";

export type HandlerResult = { status: number; body: unknown };

export abstract class BaseController {
  /** Service name for envelopes (e.g., "auth", "user"). */
  protected readonly service: string;
  /** Uniform envelope I/O */
  protected readonly rx: SvcReceiver;

  protected constructor(service: string) {
    this.service = service;
    this.rx = new SvcReceiver(service);
  }

  // ── Success/Error envelope helpers ─────────────────────────────────────────

  /**
   * Shape a success envelope `{ ok:true, service, data, requestId }`.
   */
  protected ok(
    status: number,
    data: unknown,
    requestId: string
  ): HandlerResult {
    return {
      status,
      body: { ok: true, service: this.service, data, requestId },
    };
  }

  /**
   * Shape an error envelope `{ ok:false, service, data:{status, detail}, requestId }`.
   * `code` is a short machine-readable status (e.g., "invalid_request").
   */
  protected fail(
    status: number,
    code: string,
    detail: string,
    requestId: string
  ): HandlerResult {
    return {
      status,
      body: {
        ok: false,
        service: this.service,
        data: { status: code, detail },
        requestId,
      },
    };
  }

  // ── Upstream pass-through (SvcClient → controller response) ────────────────

  /**
   * Pass an SvcClient response upstream:
   * - On success: return the upstream envelope as-is (status + body = resp.data).
   * - On error:   map to a clean bad_gateway/upstream_error envelope.
   *
   * This keeps controllers tiny and ensures consistent error surfacing.
   */
  protected passUpstream<T = unknown>(
    resp: SvcResponse<T>,
    requestId: string,
    opts: { badGatewayStatus?: number; upstreamCode?: string } = {}
  ): HandlerResult {
    const badGatewayStatus = opts.badGatewayStatus ?? 502;
    const upstreamCode = opts.upstreamCode ?? "upstream_error";

    if (resp.ok) {
      return {
        status: resp.status,
        body: (resp.data as unknown) ?? {
          ok: true,
          service: this.service,
          data: null,
          requestId,
        },
      };
    }
    const detail =
      resp.error?.message ||
      (resp.status === 0 ? "network_error" : "upstream error");
    return this.fail(
      resp.status || badGatewayStatus,
      upstreamCode,
      detail,
      requestId
    );
  }

  // ── Convenience: standardized handler wrapper (optional for children) ─────

  /**
   * Optional wrapper to reduce boilerplate in child controllers.
   * Usage:
   *   return this.handle(req, res, async ({ body, requestId }) => {
   *     // ...validate...
   *     return this.ok(200, { ... }, requestId);
   *   });
   */
  protected async handle<TCtx = { body: unknown; requestId: string }>(
    req: Request,
    res: Response,
    fn: (
      ctx: TCtx & { body: unknown; requestId: string }
    ) => Promise<HandlerResult>
  ): Promise<void> {
    return this.rx.receive(
      req as any,
      res as any,
      async ({ body, requestId }) => fn({ body, requestId } as any)
    );
  }
}
