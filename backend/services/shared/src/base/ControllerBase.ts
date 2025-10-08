// backend/services/shared/src/base/ControllerBase.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy — ControllerBase extends ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *
 * Purpose:
 * - Shared controller base:
 *   • Defines HandlerCtx and HandlerResult shapes
 *   • Provides ok()/fail() helpers for business returns
 *   • Provides handle() wrapper that builds ctx and writes canonical envelopes
 *
 * Invariants:
 * - Environment-invariant: no host/IP literals; only env/config.
 * - Canonical response envelopes:
 *     success → { ok: true,  service, data }
 *     error   → { ok: false, service, data: { status, detail? } }
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ServiceBase } from "./ServiceBase";

export type HandlerCtx = {
  requestId: string;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  headers: Record<string, string>;
};

/**
 * HandlerResult:
 * - Success shorthand: { status, body? }
 * - Error canonical:   { ok:false, status, data:{ status:<code>, detail? } }
 *
 * NOTE: We allow the success shorthand without an explicit `ok` flag,
 *       since most controllers already return { status, body }.
 */
export type HandlerResult =
  | { status: number; body?: unknown } // success shorthand
  | { ok: false; status: number; data: { status: string; detail?: unknown } }; // error

export abstract class ControllerBase extends ServiceBase {
  protected constructor(opts?: {
    service?: string;
    context?: Record<string, unknown>;
  }) {
    super({
      service: opts?.service,
      context: { component: "Controller", ...(opts?.context ?? {}) },
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Convenience builders for controller business methods
  // ──────────────────────────────────────────────────────────────────────────

  /** Build a success result. Usage: return this.ok(201, payload) or this.ok(payload) */
  protected ok(
    statusOrBody?: number | unknown,
    maybeBody?: unknown
  ): HandlerResult {
    if (typeof statusOrBody === "number") {
      return { status: statusOrBody, body: maybeBody };
    }
    return { status: 200, body: statusOrBody };
    // If both args omitted, this.ok() → { status:200 }
  }

  /**
   * Build an error result with canonical shape.
   * @param httpStatus  HTTP status (e.g., 400, 401, 404, 422, 502)
   * @param code        machine-readable status code (e.g., "invalid_request")
   * @param detail      optional human/context detail
   */
  protected fail(
    httpStatus: number,
    code: string,
    detail?: unknown /*, requestId?: string */
  ): HandlerResult {
    return { ok: false, status: httpStatus, data: { status: code, detail } };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Express adapter: wrap business(ctx) into a RequestHandler
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Wraps a business function that consumes HandlerCtx and returns HandlerResult
   * into an Express RequestHandler that writes canonical envelopes.
   */
  public handle(
    business: (ctx: HandlerCtx) => HandlerResult | Promise<HandlerResult>
  ): RequestHandler {
    const log = this.bindLog({ kind: "http", adapter: "controller_handle" });

    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const requestId = (req.header("x-request-id") ||
          req.header("x-correlation-id") ||
          req.header("request-id") ||
          "") as string;

        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (v == null) continue;
          headers[k.toLowerCase()] = Array.isArray(v)
            ? String(v[0])
            : String(v);
        }

        const ctx: HandlerCtx = {
          requestId,
          body: (req as any).body,
          params: (req.params ?? {}) as Record<string, string>,
          query: (req.query ?? {}) as Record<string, unknown>,
          headers,
        };

        log.debug(
          { url: req.originalUrl, method: req.method },
          "controller_enter"
        );

        const result = await business(ctx);

        // Error branch: explicit { ok:false, ... }
        if ((result as any)?.ok === false) {
          const errRes = result as Extract<HandlerResult, { ok: false }>;
          const statusCode = errRes.status ?? 500;
          res
            .status(statusCode)
            .json({ ok: false, service: this.service, data: errRes.data });
          log.debug({ status: statusCode }, "controller_exit_error");
          return;
        }

        // Success branch (shorthand)
        const okRes = result as Extract<HandlerResult, { status: number }>;
        const statusCode = okRes.status ?? 200;
        const payload =
          (okRes as any).body !== undefined ? (okRes as any).body : undefined;

        if (payload !== undefined) {
          res
            .status(statusCode)
            .json({ ok: true, service: this.service, data: payload });
        } else {
          res.status(statusCode).json({ ok: true, service: this.service });
        }

        log.debug({ status: statusCode }, "controller_exit_ok");
      } catch (err) {
        log.error({ err: String(err) }, "controller_error");
        next(err);
      }
    };
  }
}
