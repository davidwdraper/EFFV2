// backend/services/shared/src/controllers/base.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0006 (Gateway Edge Logging — first-class edge() channel)
 *
 * Purpose:
 * - Super controller base for all services.
 * - Centralizes envelope-aware request/response handling on top of SvcReceiver.
 * - Provides helpers to shape success/error envelopes and to pass upstream
 *   envelopes through unchanged (for S2S proxy-style endpoints).
 *
 * Notes:
 * - Controllers extend ServiceBase to get `this.log` (bound logger) and env helpers.
 * - Uses overloaded logger methods:
 *     log.info("msg")  OR  log.info({ctx}, "msg")
 *     log.edge({ctx}, "edge hit")   // category defaults to "edge"
 */

import type { Request, Response, RequestHandler, NextFunction } from "express";
import { ServiceBase } from "../base/ServiceBase";
import { SvcReceiver } from "../svc/SvcReceiver";
import type { SvcResponse } from "../svc/types";
import { UrlHelper } from "../http/UrlHelper";

export type HandlerResult = { status: number; body: unknown };

export abstract class BaseController extends ServiceBase {
  /** Uniform envelope I/O */
  protected readonly rx: SvcReceiver;

  protected constructor(service: string) {
    super({ service, context: { controller: "BaseController" } });
    this.rx = new SvcReceiver(service);
  }

  // ── Success/Error envelope helpers ─────────────────────────────────────────

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
   * Also emits:
   *   EDGE once at entry (first-class `edge()` method)
   *   INFO once at entry (structured)
   *
   * Note:
   * - We delegate response writing to SvcReceiver; `fn` returns a HandlerResult
   *   which SvcReceiver uses to shape the HTTP response.
   */
  protected async handle<TCtx = { body: unknown; requestId: string }>(
    req: Request,
    res: Response,
    fn: (
      ctx: TCtx & { body: unknown; requestId: string }
    ) => Promise<HandlerResult>
  ): Promise<void> {
    // Derive slug/version for logging
    let slug = this.service;
    let version = 1;
    try {
      const addr = UrlHelper.parseApiPath(req.originalUrl);
      slug = addr.slug || this.service;
      version = addr.version ?? 1;
    } catch {
      // not an /api/* path — keep defaults
    }

    const requestId =
      (req.headers["x-request-id"] as string | undefined) ||
      (res.getHeader("x-request-id") as string | undefined) ||
      "";

    const bound = this.bindLog({
      slug,
      version,
      url: req.originalUrl,
      method: req.method,
      requestId,
    });

    // Proper overloaded calls (no-arg forms removed)
    bound.edge({ hit: "entry" }, "edge hit");
    bound.info({ event: "controller_entry" }, "controller entry");

    return this.rx.receive(
      req as any,
      res as any,
      async ({ body, requestId: rid }) => fn({ body, requestId: rid } as any)
    );
  }

  // ── Route adapter: guarantees logging by routing through handle(...) ───────
  /**
   * Usage in routers:
   *   const ctrl = new UserController();
   *   router.get("/health", ctrl.h(async ({ requestId }) => ctrl.health(requestId)));
   *   router.post("/v1/create", ctrl.h(async ({ body, requestId }) => ctrl.create(body, requestId)));
   *
   * This avoids drift: every route uses the same logging + envelope path.
   */
  public h<TCtx = { body: unknown; requestId: string }>(
    fn: (
      ctx: TCtx & { body: unknown; requestId: string }
    ) => Promise<HandlerResult>
  ): RequestHandler {
    return (req: Request, res: Response, _next: NextFunction) => {
      void this.handle<TCtx>(req, res, fn);
    };
  }
}
