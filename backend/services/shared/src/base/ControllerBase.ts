// backend/services/shared/src/http/ControllerBase.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (DTO Hydration & Failure Propagation)
 * - ADR-0044 (SvcEnv as DTO — Key/Value Contract)
 *
 * Purpose:
 * - Shared abstract controller base for all services.
 * - Injects AppBase instance; seeds HandlerContext; finalizes responses.
 *
 * Notes:
 * - NO index work here. Indexes are ensured at boot by the app (see ensureIndexes.ts).
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
  protected readonly log!: IBoundLogger; // definite assignment OK

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

  /** Create and seed HandlerContext per ADR-0042. */
  protected makeContext(req: Request, res: Response): HandlerContext {
    const ctx = new HandlerContext();
    const requestId = (req.headers["x-request-id"] as string) ?? this.randId();

    ctx.set("requestId", requestId);
    ctx.set("headers", req.headers);
    ctx.set("params", req.params);
    ctx.set("query", req.query);
    ctx.set("body", req.body);
    ctx.set("App", this.app);
    ctx.set("res", res);

    const svcEnv: SvcEnvDto | undefined =
      (this.app as any)?.svcEnv ??
      (this.app as any)?.env ??
      (this.app as any)?.getEnv?.() ??
      (this.app as any)?.getSvcEnv?.();

    if (svcEnv) {
      ctx.set("svcEnv", svcEnv);
    } else {
      ctx.set("handlerStatus", "error");
      ctx.set("status", 500);
      ctx.set("error", {
        code: "SVCENV_MISSING",
        message:
          "SvcEnvDto not available. Ops: ensure App exposes svcEnv or getter for env DTO.",
        hint: "AppBase owns envDto; export via public getter.",
      });
    }

    this.log.debug(
      { event: "make_context", requestId, hasSvcEnv: !!svcEnv },
      "Context seeded"
    );
    return ctx;
  }

  /** Controller finalization — maps context → HTTP per ADR-0043. */
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
    // Prefer detail over message to surface driver errors (earlier change)
    const detail = err?.detail ?? err?.message ?? "Unhandled error";
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
