// backend/services/shared/src/base/ControllerBase.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0014 (Base Hierarchy — ControllerBase extends ServiceBase)
 *   - ADR-0015 (Structured Logger with bind() Context)
 *   - ADR-0041 (Controller & Handler Architecture)
 *   - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Shared controller base:
 *   • Constructs and seeds HandlerContext (the request “bus”).
 *   • Adapts controller business functions to Express.
 *   • Emits canonical envelopes based solely on HandlerContext keys.
 *
 * Invariants:
 * - Controllers contain no business logic.
 * - Derived controllers cannot alter HandlerContext construction.
 * - Success → { ok:true,  service, data? }
 * - Error   → { ok:false, service, data:{ status, detail? } }
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ServiceBase } from "./ServiceBase";
import { HandlerContext, CtxKeys } from "../http/HandlerContext";

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

  // ────────────────────────────────────────────────────────────────
  // Express adapter: wrap business(ctx) into a RequestHandler
  // ────────────────────────────────────────────────────────────────

  /**
   * Wraps a controller-specific business function that:
   *  - receives a seeded HandlerContext (the bus),
   *  - runs its handler chain,
   *  - writes results into the context (CtxKeys.*),
   *  - returns void/Promise<void>.
   *
   * The HTTP response is produced **only** from the context keys:
   *  - Error keys (ErrStatus/ErrCode/ErrDetail) short-circuit to error envelope
   *  - Otherwise ResStatus/ResBody drive the success envelope (default 200)
   */
  public handle(
    business: (ctx: HandlerContext) => void | Promise<void>
  ): RequestHandler {
    const log = this.bindLog({ kind: "http", adapter: "controller_handle" });

    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Build + seed the HandlerContext (KISS bus)
        const ctx = new HandlerContext();
        ctx.set(
          CtxKeys.RequestId,
          (req.header("x-request-id") ?? "") as string
        );
        ctx.set(CtxKeys.Headers, req.headers as Record<string, unknown> as any);
        ctx.set(CtxKeys.Params, (req.params ?? {}) as Record<string, string>);
        ctx.set(CtxKeys.Query, (req.query ?? {}) as Record<string, unknown>);
        ctx.set(CtxKeys.Body, (req as any).body);

        log.debug(
          { url: req.originalUrl, method: req.method },
          "controller_enter"
        );

        // Execute controller-defined orchestration (handler chain)
        await business(ctx);

        // 1) Error branch (fail-fast)
        const errStatus = ctx.get<number>(CtxKeys.ErrStatus);
        if (typeof errStatus === "number") {
          const code = ctx.get<string>(CtxKeys.ErrCode) ?? "error";
          const detail = ctx.get(CtxKeys.ErrDetail);
          res.status(errStatus).json({
            ok: false,
            service: this.service,
            data: { status: code, detail },
          });
          log.debug({ status: errStatus }, "controller_exit_error");
          return;
        }

        // 2) Success branch
        const status = ctx.get<number>(CtxKeys.ResStatus) ?? 200;
        const body = ctx.get(CtxKeys.ResBody);

        if (body !== undefined) {
          res
            .status(status)
            .json({ ok: true, service: this.service, data: body });
        } else {
          res.status(status).json({ ok: true, service: this.service });
        }

        log.debug({ status }, "controller_exit_ok");
      } catch (err) {
        log.error({ err: String(err) }, "controller_error");
        next(err);
      }
    };
  }
}
