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
 * Env:
 * - LOG_LEVEL (optional) debug|info|warn|error|silent  [default: info]
 * - LOG_EDGE  (optional) 1|true|on to enable EDGE one-liners               [default: off]
 *
 * Design:
 * - Child controllers call `this.rx.receive(...)` inside `handle(...)`.
 * - **Logging** (service-side):
 *     - EDGE once per endpoint hit: "EDGE YYYY-MM-DD HH:MM:SS <slug> v<version> <url>"
 *     - INFO once per endpoint hit: "INFO YYYY-MM-DD HH:MM:SS <slug> v<version> <url>"
 */

import type { Request, Response } from "express";
import { SvcReceiver } from "../svc/SvcReceiver";
import type { SvcResponse } from "../svc/types";
import { UrlHelper } from "../http/UrlHelper";
import { log } from "../util/Logger";

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
   *   EDGE once at entry (toggle via LOG_EDGE)
   *   INFO once at entry (toggle via LOG_LEVEL)
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

    const bound = log.bind({ slug, version, url: req.originalUrl });
    bound.edge(); // "EDGE YYYY-MM-DD HH:MM:SS <slug> v<version> <url>" (if LOG_EDGE=on)
    bound.info(); // "INFO YYYY-MM-DD HH:MM:SS <slug> v<version> <url>"

    return this.rx.receive(
      req as any,
      res as any,
      async ({ body, requestId }) => fn({ body, requestId } as any)
    );
  }
}
