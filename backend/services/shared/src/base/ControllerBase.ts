// backend/services/shared/src/http/ControllerBase.ts
/**
 * Docs:
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (DTO Hydration & Context-Driven Failure Propagation)
 *
 * Purpose:
 * - Shared controller base:
 *   • Accepts service app via DI
 *   • Seeds HandlerContext (incl. "App")
 *   • finalize(ctx) maps context → HTTP response
 */

import type { Request, Response } from "express";
import { HandlerContext } from "@nv/shared/http/HandlerContext";
import { getLogger, type IBoundLogger } from "@nv/shared/logger/Logger";

type ProblemJson = {
  type: string;
  title: string;
  detail?: string;
  status?: number;
  code?: string;
  issues?: Array<{ path: string; code: string; message: string }>;
  requestId?: string;
};

export abstract class ControllerBase {
  protected readonly app: unknown;
  protected readonly log: IBoundLogger;

  constructor(app: unknown) {
    this.app = app;
    // Prefer the service’s bound logger if present; else create one.
    const appLog = (app as any)?.log as IBoundLogger | undefined;
    this.log =
      appLog?.bind({ component: "ControllerBase" }) ??
      getLogger({ service: "shared", component: "ControllerBase" });

    this.log.debug(
      { event: "construct", hasApp: !!app },
      "ControllerBase ctor"
    );
  }

  /** Seed a fresh HandlerContext (ADR-0042). */
  protected makeContext(req: Request, res: Response): HandlerContext {
    const ctx = new HandlerContext();

    const requestId = (req.headers["x-request-id"] as string) ?? this.randId();

    ctx.set("requestId", requestId);
    ctx.set("headers", req.headers);
    ctx.set("params", req.params);
    ctx.set("query", req.query);
    ctx.set("body", req.body);

    // DI app into context (your requirement): handlers can use App.log
    ctx.set("App", this.app);
    ctx.set("res", res);

    this.log.debug({ event: "make_context", requestId }, "Context seeded");
    return ctx;
  }

  /**
   * Final line in controllers: return super.finalize(ctx)
   * Maps HandlerContext → HTTP per ADR-0043.
   */
  protected finalize(ctx: HandlerContext): void {
    const res = ctx.get<Response>("res")!;
    const requestId = ctx.get<string>("requestId") ?? "";
    const handlerStatus = (
      ctx.get<string>("handlerStatus") ?? "ok"
    ).toLowerCase();
    const statusFromCtx = ctx.get<number>("status");
    const error = ctx.get<any>("error");
    const warnings = ctx.get<any[]>("warnings");
    const result = ctx.get<any>("result");

    this.log.debug(
      { event: "finalize_enter", requestId, handlerStatus, statusFromCtx },
      "Finalize start"
    );

    // Error path
    if (handlerStatus === "error" || (statusFromCtx && statusFromCtx >= 400)) {
      const status =
        statusFromCtx && statusFromCtx >= 400 ? statusFromCtx : 500;
      const body: ProblemJson = this.toProblemJson(error, status, requestId);
      res.status(status).type("application/problem+json").json(body);
      this.log.error(
        { event: "finalize_error", requestId, status, problem: body },
        "Controller error response"
      );
      this.log.debug({ event: "finalize_exit", requestId }, "Finalize end");
      return;
    }

    // Warning path (no error)
    if (handlerStatus === "warn") {
      if (Array.isArray(warnings)) {
        for (const w of warnings) {
          this.log.warn(
            { event: "warn", requestId, warning: w },
            "Handler warning"
          );
        }
      }
      res.status(200).json(result ?? { ok: true, warnings });
      this.log.debug({ event: "finalize_exit", requestId }, "Finalize end");
      return;
    }

    // OK path
    res.status(200).json(result ?? { ok: true });
    this.log.debug({ event: "finalize_exit", requestId }, "Finalize end");
  }

  // ───────────── helpers ─────────────

  private toProblemJson(
    err: any,
    status: number,
    requestId?: string
  ): ProblemJson {
    const code = err?.code ?? "UNSPECIFIED";
    const detail = err?.message ?? err?.detail ?? "Unhandled error";
    const issues = Array.isArray(err?.issues) ? err.issues : undefined;

    return {
      type: "about:blank",
      title:
        err?.title ?? (status >= 500 ? "Internal Server Error" : "Bad Request"),
      detail,
      status,
      code,
      issues,
      requestId,
    };
  }

  private randId(): string {
    return Math.random().toString(36).slice(2, 10);
  }
}
