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
 * - ADR-0059 (dtoType and dbCollectionName addition to handler ctx)
 *
 * Purpose:
 * - Shared abstract controller base for all services.
 * - Owns AppBase reference; seeds HandlerContext; preflights invariants; finalizes responses.
 *
 * Notes:
 * - Indexes are ensured at app boot — never here.
 * - Success responses are always built from ctx["bag"] (DtoBag) only.
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

  // ─────────────── Context build / pipeline helpers ──────────────────────────

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

  /**
   * Helper for dtoType-based routes (create/read/delete/etc.).
   *
   * Responsibilities:
   * - Build a HandlerContext via makeContext().
   * - Extract :dtoType from req.params and stamp into ctx["dtoType"].
   * - Stamp operation name into ctx["op"].
   * - Optionally resolve db.collectionName via DtoRegistry and stamp into ctx["db.collectionName"].
   *
   * On error (missing :dtoType, registry/collection issues), this method:
   * - Sets handlerStatus="error" and response.status/response.body on the ctx.
   * - Logs a warning.
   * - Returns the ctx so the controller can immediately finalize().
   */
  protected makeDtoOpContext(
    req: Request,
    res: Response,
    op: string,
    opts?: { resolveCollectionName?: boolean }
  ): HandlerContext {
    const ctx = this.makeContext(req, res);
    const params: any = req.params ?? {};
    const dtoType = typeof params.dtoType === "string" ? params.dtoType : "";
    const requestId = ctx.get<string>("requestId") ?? "unknown";

    if (!dtoType || !dtoType.trim()) {
      ctx.set("handlerStatus", "error");
      ctx.set("response.status", 400);
      ctx.set("response.body", {
        code: "BAD_REQUEST",
        title: "Bad Request",
        detail: "Missing required path parameter ':dtoType'.",
        hint: "Routes must be shaped as /api/:slug/v:version/:dtoType/<op>[/:id]",
        requestId,
      });

      this.log.warn(
        { event: "bad_request", reason: "no_dtoType", op, requestId },
        "ControllerBase.makeDtoOpContext — missing :dtoType"
      );
      return ctx;
    }

    ctx.set("dtoType", dtoType);
    ctx.set("op", op);

    if (opts?.resolveCollectionName) {
      try {
        const reg = this.getDtoRegistry();
        const coll = (reg as any).dbCollectionNameByType?.(dtoType) as
          | string
          | undefined;

        if (!coll || !coll.trim()) {
          throw new Error(`No collection mapped for dtoType="${dtoType}"`);
        }

        ctx.set("db.collectionName", coll);
      } catch (e: any) {
        ctx.set("handlerStatus", "error");
        ctx.set("response.status", 400);
        ctx.set("response.body", {
          code: "UNKNOWN_DTO_TYPE",
          title: "Bad Request",
          detail:
            e?.message ??
            `Unable to resolve collection for dtoType "${dtoType}".`,
          hint: "Verify the DtoRegistry contains this dtoType and exposes a collection name.",
          requestId,
        });

        this.log.warn(
          {
            event: "dto_type_resolve_failed",
            dtoType,
            op,
            err: e?.message,
            requestId,
          },
          "ControllerBase.makeDtoOpContext — failed to resolve collection"
        );
        return ctx;
      }
    }

    this.log.debug(
      {
        event: "pipeline_select",
        op,
        dtoType,
        requestId,
      },
      "selecting pipeline"
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

  // ─────────────── Finalize: bag-or-error only ───────────────────────────────

  protected finalize(ctx: HandlerContext): void {
    const res = ctx.get<Response>("res")!;
    const requestId = ctx.get<string>("requestId") ?? "";
    const rawStatus = ctx.get<string>("handlerStatus") ?? "ok";
    const handlerStatus = rawStatus.toLowerCase();
    const statusFromCtx =
      ctx.get<number>("response.status") ?? ctx.get<number>("status");
    const error = ctx.get<any>("response.body")?.code
      ? ctx.get<any>("response.body")
      : ctx.get<any>("error");
    const warnings = ctx.get<any[]>("warnings");

    this.log.debug(
      { event: "finalize_enter", requestId, handlerStatus, statusFromCtx },
      "Finalize start"
    );

    // ── 1) Error path: only place where handlers may prebuild a body ──
    if (handlerStatus === "error" || (statusFromCtx && statusFromCtx >= 400)) {
      const status =
        statusFromCtx && statusFromCtx >= 400 ? statusFromCtx : 500;

      // Normalize duplicate-key codes using existing parser.
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

    // ── 2) Success / warn path: MUST have a DtoBag on ctx["bag"] ──
    const bag: any = ctx.get<any>("bag");

    if (!bag || typeof bag.toJson !== "function") {
      const status = 500;
      const body: ProblemJson = {
        type: "about:blank",
        title: "Internal Error",
        detail:
          'Handler pipeline completed without attaching a DtoBag at ctx["bag"].',
        status,
        code: "BAG_MISSING",
        requestId,
      };

      res.status(status).type("application/problem+json").json(body);

      this.log.error(
        {
          event: "finalize_bag_missing",
          requestId,
          handlerStatus,
          hasBag: !!bag,
          bagType: bag ? typeof bag : "undefined",
        },
        "Finalize — missing DtoBag for successful response"
      );

      this.log.debug({ event: "finalize_exit", requestId }, "Finalize end");
      return;
    }

    const items = bag.toJson() as any[];

    const dtoType = ctx.get<string>("dtoType");
    const op = ctx.get<string>("op");
    const idKey = ctx.get<string>("idKey");

    const meta: Record<string, unknown> = {
      count: Array.isArray(items) ? items.length : 0,
    };
    if (dtoType) meta.dtoType = dtoType;
    if (op) meta.op = op;
    if (idKey) meta.idKey = idKey;

    const body: any = { items, meta };

    if (Array.isArray(warnings) && warnings.length > 0) {
      body.warnings = warnings;
      for (const w of warnings) {
        this.log.warn(
          { event: "warn", requestId, warning: w },
          "Handler warning"
        );
      }
    }

    const successStatus =
      ctx.get<number>("response.status") ??
      (handlerStatus === "warn" ? 200 : 200);

    res.status(successStatus).json(body);

    this.log.debug(
      {
        event: "finalize_exit",
        requestId,
        dtoType,
        op,
        idKey,
        count: meta.count,
      },
      "Finalize — DtoBag materialized to wire envelope"
    );
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
