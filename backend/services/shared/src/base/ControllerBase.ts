// backend/services/shared/src/http/ControllerBase.ts
/**
 * Docs:
 * - ADR-0041/0042/0043
 *
 * Purpose:
 * - Shared controller base:
 *   • Accepts service app via DI
 *   • Seeds HandlerContext (incl. "App" and **"svcEnv"**)
 *   • finalize(ctx) maps context → HTTP response
 */

import type { Request, Response } from "express";
import { HandlerContext } from "../http/HandlerContext";
import { getLogger, type IBoundLogger } from "../logger/Logger";
import type { SvcEnvDto } from "../dto/svcenv.dto";

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

    // Inject App for direct access to bound loggers etc.
    ctx.set("App", this.app);
    ctx.set("res", res);

    // Try to expose SvcEnvDto from the app — supports several shapes to avoid tight coupling
    const svcEnv: SvcEnvDto | undefined =
      (this.app as any)?.svcEnv ??
      (this.app as any)?.env ??
      (this.app as any)?.getEnv?.() ??
      (this.app as any)?.getSvcEnv?.();

    if (svcEnv) {
      ctx.set("svcEnv", svcEnv);
    } else {
      // No svcEnv — downstream env-validation handler should fail fast
      ctx.set("handlerStatus", "error");
      ctx.set("status", 500);
      ctx.set("error", {
        code: "SVCENV_MISSING",
        message:
          "SvcEnvDto not available on App. Ops: ensure App exposes svcEnv via a public getter or property.",
        hint: "AppBase holds envDto; provide a public accessor and ensure ControllerBase can read it.",
      });
    }

    this.log.debug(
      { event: "make_context", requestId, hasSvcEnv: !!svcEnv },
      "Context seeded"
    );
    return ctx;
  }

  /** Controllers end with: return super.finalize(ctx) */
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

    res.status(200).json(result ?? { ok: true });
    this.log.debug({ event: "finalize_exit", requestId }, "Finalize end");
  }

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
