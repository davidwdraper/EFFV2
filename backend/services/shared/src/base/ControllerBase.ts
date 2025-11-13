// backend/services/shared/src/base/ControllerBase.ts
/**
 * Docs:
 * - ADR-0040 (DTO-Only Persistence via Managers)
 * - ADR-0041 (Controller & Handler Architecture)
 * - ADR-0042 (HandlerContext Bus)
 * - ADR-0043 (DTO Hydration & Failure Propagation)
 * - ADR-0044 (EnvServiceDto as DTO — Key/Value Contract)
 * - ADR-0049 (DTO Registry & Wire Discrimination)
 * - ADR-0050 (Wire Bag Envelope; bag-only edges)
 *
 * Purpose:
 * - Shared abstract controller base for all services.
 * - Owns AppBase reference; seeds HandlerContext; preflights invariants; finalizes responses.
 *
 * Notes:
 * - Indexes are ensured at app boot — never here.
 */

import type { Request, Response } from "express";
import { HandlerContext } from "../http/handlers/HandlerContext";
import type { HandlerBase } from "../http/handlers/HandlerBase";
import { getLogger, type IBoundLogger } from "../logger/Logger";
import type { EnvServiceDto } from "../dto/env-service.dto";
import type { AppBase } from "../base/AppBase";
import type { IDtoRegistry } from "../registry/RegistryBase";
import {
  DuplicateKeyError,
  parseDuplicateKey,
} from "../dto/persistence/adapters/mongo/dupeKeyError";

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
  protected readonly app: AppBase;
  protected readonly log!: IBoundLogger; // definite assignment OK

  constructor(app: AppBase) {
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

  // ─────────────── Public getters for handlers (strict contract) ─────────────

  public getApp(): AppBase {
    return this.app;
  }

  public getDtoRegistry(): IDtoRegistry {
    const reg = (this.app as any)?.getDtoRegistry?.();
    if (!reg) {
      throw new Error("DtoRegistry not available from AppBase.");
    }
    return reg as IDtoRegistry;
  }

  public getSvcEnv(): EnvServiceDto {
    const env = (this.app as any)?.svcEnv;
    if (!env) throw new Error("EnvServiceDto not available from AppBase.");
    return env as EnvServiceDto;
  }

  public getLogger(): IBoundLogger {
    return this.log;
  }

  protected seedHydrator(
    ctx: HandlerContext,
    dtoType: string,
    opts?: { validate?: boolean }
  ): void {
    const reg: any = this.getDtoRegistry();
    const hydrate = reg.hydratorFor(dtoType, { validate: !!opts?.validate });
    ctx.set("hydrate.fromJson", hydrate);
    this.log.debug(
      { event: "seed_hydrator", dtoType, validate: !!opts?.validate },
      "ControllerBase"
    );
  }

  // ─────────────── Context build / pipeline / finalize ───────────────────────

  protected makeContext(req: Request, res: Response): HandlerContext {
    const ctx = new HandlerContext();
    const requestId = (req.headers["x-request-id"] as string) ?? this.randId();

    ctx.set("requestId", requestId);
    ctx.set("headers", req.headers);
    ctx.set("params", req.params);
    ctx.set("query", req.query);
    ctx.set("body", req.body);
    ctx.set("res", res);

    const svcEnv: EnvServiceDto | undefined = this.getSvcEnv();
    if (svcEnv) {
      ctx.set("svcEnv", svcEnv);
    } else {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 500);
      ctx.set("response.body", {
        code: "ENV_DTO_MISSING",
        title: "Internal Error",
        detail:
          "EnvServiceDto not available. Ops: ensure AppBase exposes svcEnv via a public getter.",
        hint: "AppBase owns envDto; export via a public getter returning EnvServiceDto.",
      });
    }

    this.log.debug(
      { event: "make_context", requestId, hasSvcEnv: !!svcEnv },
      "Context seeded"
    );
    return ctx;
  }

  protected preflight(
    ctx: HandlerContext,
    opts?: { requireRegistry?: boolean }
  ): void {
    const requireRegistry =
      opts?.requireRegistry ?? this.needsRegistry() ?? true;

    const requestId = ctx.get<string>("requestId") ?? "unknown";

    const svcEnv = ctx.get<EnvServiceDto>("svcEnv");
    if (!svcEnv) {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 500);
      ctx.set("response.body", {
        code: "ENV_DTO_MISSING",
        title: "Internal Error",
        detail:
          "EnvServiceDto missing in context. Ops: AppBase must expose the environment DTO; ControllerBase seeds it into HandlerContext.",
        requestId,
      });
      return;
    }

    if (requireRegistry) {
      try {
        void this.getDtoRegistry(); // throws if missing
      } catch (_e) {
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 500);
        ctx.set("response.body", {
          code: "REGISTRY_MISSING",
          title: "Internal Error",
          detail:
            "DtoRegistry missing on AppBase. Ops: wire AppBase.getDtoRegistry() to return a concrete registry instance.",
          requestId,
        });
        return;
      }
    }

    this.log.debug(
      {
        event: "preflight_ok",
        requestId,
        requireRegistry,
        hasRegistry: requireRegistry ? true : undefined,
      },
      "Preflight passed"
    );
  }

  protected async runPipeline(
    ctx: HandlerContext,
    handlers: HandlerBase[],
    opts?: { requireRegistry?: boolean }
  ): Promise<void> {
    const priorError = ctx.get<string>("handlerStatus") === "error";
    if (!priorError) this.preflight(ctx, opts);

    if (ctx.get<string>("handlerStatus") === "error") return;

    for (const h of handlers) {
      // eslint-disable-next-line no-await-in-loop
      await h.run();
    }
  }

  protected finalize(ctx: HandlerContext): void {
    const res = ctx.get<Response>("res")!;
    const requestId = ctx.get<string>("requestId") ?? "";
    const handlerStatus = (
      ctx.get<string>("handlerStatus") ?? "ok"
    ).toLowerCase();
    const statusFromCtx =
      ctx.get<number>("response.status") ?? ctx.get<number>("status");
    const error = ctx.get<any>("response.body")?.code
      ? ctx.get<any>("response.body")
      : ctx.get<any>("error");
    const warnings = ctx.get<any[]>("warnings");
    const result = ctx.get<any>("result");

    this.log.debug(
      { event: "finalize_enter", requestId, handlerStatus, statusFromCtx },
      "Finalize start"
    );

    if (handlerStatus === "error" || (statusFromCtx && statusFromCtx >= 400)) {
      const status =
        statusFromCtx && statusFromCtx >= 400 ? statusFromCtx : 500;

      // If a handler prebuilt a body, normalize duplicate-key codes using the existing parser.
      let normalized = error;
      if (error && error.title && error.code) {
        const maybeDup =
          parseDuplicateKey({
            message: error.detail ?? error.message ?? "",
            code: 11000,
          }) ?? parseDuplicateKey(error);
        if (maybeDup) {
          const idx = (maybeDup.index ?? "").toString();
          const mappedCode =
            idx === "ux_xxx_business"
              ? "DUPLICATE_CONTENT"
              : idx === "_id_"
              ? "DUPLICATE_ID"
              : "DUPLICATE_KEY";
          normalized = { ...error, code: mappedCode };
        }
      }

      const body: ProblemJson =
        normalized && normalized.title && normalized.code
          ? {
              type: "about:blank",
              title: normalized.title,
              detail: normalized.detail ?? normalized.message,
              status,
              code: normalized.code,
              issues: normalized.issues,
              requestId,
            }
          : this.toProblemJson(normalized, status, requestId);

      res.status(status).type("application/problem+json").json(body);

      if (status >= 500) {
        this.log.error(
          { event: "finalize_error", requestId, status, problem: body },
          "Controller error response"
        );
      } else {
        this.log.warn(
          { event: "finalize_client_error", requestId, status, problem: body },
          "Controller client/data response"
        );
      }

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
      const body =
        result && typeof result === "object"
          ? { ...result, warnings }
          : { ok: true, warnings };
      res.status(200).json(body);
      this.log.debug({ event: "finalize_exit", requestId }, "Finalize end");
      return;
    }

    const prebuiltStatus =
      ctx.get<number>("response.status") ?? (result ? 200 : undefined);
    const prebuiltBody =
      ctx.get<any>("response.body") ??
      result ??
      ({ ok: true } as Record<string, unknown>);

    res.status(prebuiltStatus ?? 200).json(prebuiltBody);
    this.log.debug({ event: "finalize_exit", requestId }, "Finalize end");
  }

  // eslint-disable-next-line class-methods-use-this
  protected needsRegistry(): boolean {
    return true;
  }

  private toProblemJson(
    err: any,
    status: number,
    requestId?: string
  ): ProblemJson {
    if (err instanceof DuplicateKeyError) {
      const idx = (err.index ?? "").toString();
      const code =
        idx === "ux_xxx_business"
          ? "DUPLICATE_CONTENT"
          : idx === "_id_"
          ? "DUPLICATE_ID"
          : "DUPLICATE_KEY";

      return {
        type: "about:blank",
        title: "Conflict",
        detail: err.message,
        status: 409,
        code,
        requestId,
      };
    }

    const code = err?.code ?? "UNSPECIFIED";
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
